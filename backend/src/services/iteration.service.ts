import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  TooManyRequestsError,
} from '../utils/errors';
import { env } from '../config/env';
import { Semaphore } from '../utils/semaphore';
import { singleFlight } from '../utils/singleFlight';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import {
  generatePersonaResponse,
  generateModeratorMessage,
  buildDiscussionContext,
  MODE_DEBATE,
  MODE_INTERVIEW,
  GOAL_LABELS,
} from './llm.service';
import { toTimelineDTO, TimelineMessageDTO } from './discussion.service';
import { discussionRepository } from '../repositories/discussion.repository';

export interface IterationResultDTO {
  currentIteration: number;
  status: 'running' | 'completed';
  messages: TimelineMessageDTO[];
}

// The critical section below makes sequential LLM calls (one per persona, plus
// the moderator) inside a single Postgres transaction, so it holds one pooled
// connection for the whole round. That coupling is SECURITY.md item 10.
//
// It is still a transaction, and still holds a connection — what changed in
// stage E4 is that the number of rounds able to do so at once is now bounded
// (see roundSlots below), so rounds can no longer exhaust the pool.
//
// Measured before choosing, because the audit's premise turned out to be wrong
// for this deployment. It claimed 5–10 concurrent rounds exhaust the pool; the
// container reports 24 CPUs, so Prisma's default pool is 49, and 10 concurrent
// long transactions left ordinary queries answering in 1–8 ms. The failure mode
// at 49 is real and ugly though: an unrelated query waits the full 10s
// pool_timeout and then fails with P2024, and a 50th round fails with P2028.
// So the risk is genuine, just at a threshold four times higher than stated.
//
// The reservation alternative (short transaction to claim the round, LLM calls
// outside it, an "iteration in progress" column with a TTL and stale-state
// cleanup) was reconsidered here and rejected again, for the reasons recorded
// originally plus one more: it gives up the atomicity of the round. Today a
// crash mid-round rolls back cleanly — no half-written transcript, no counter
// desync. With reservation, every partial state becomes a state the code must
// recognise and repair. A semaphore buys the same protection against pool
// exhaustion without touching either invariant.
const RUN_ITERATION_TX_TIMEOUT_MS = 120_000;

// How many rounds may hold a connection at once, and how long a caller waits
// for a slot. The limit and the measurement behind it live in
// config/limits.ts; the wait is long enough to absorb two rounds overlapping by
// a few seconds and short enough that a queued request does not look like a
// hung one (a round itself takes ~7s measured: 8 personas plus moderator at
// ~0.8s per call).
const ROUND_SLOT_WAIT_MS = 15_000;

const roundSlots = new Semaphore(env.llm.maxConcurrentRounds);

// Projects with a round in flight in this process.
//
// This exists because the semaphore would otherwise weaken the BUG-4
// guarantee instead of leaving it alone. The advisory lock rejects a duplicate
// only while both calls are inside their transactions at the same time. Once a
// caller can be made to *wait* for a slot, a double-click stops being
// concurrent: the first round commits, the queued one then starts cleanly and
// runs the *next* round. Two clicks would produce two rounds — not a crash, but
// a direct contradiction of "one click runs exactly one round".
//
// So duplicates are refused here, before any slot is taken, and the advisory
// lock keeps doing its job for calls that do overlap. The check and the insert
// are adjacent with no await between them, so on a single-threaded event loop
// two simultaneous requests cannot both see an empty set.
//
// In-process like the semaphore: the advisory lock, not this guard, is what
// would still protect a second replica. Same wording and status as the advisory
// lock's rejection, because to the caller it is the same condition: this
// project is already running.
const roundFlight = singleFlight((projectId) => `An iteration is already running for project ${projectId}`);

const STANCE_FOR = 'Поддерживает';
const STANCE_AGAINST = 'Против';

type ProjectPersonaRow = { stanceOverride: string | null; persona: { stance: string } };

// Debate mode seats the two camps alternately so every reply lands on an
// opponent, instead of letting all supporters speak in a row. Undecided and
// neutral personas are spread between the camps rather than dropped, so the
// round still contains everyone exactly once.
function debateOrder<T extends ProjectPersonaRow>(rows: T[]): T[] {
  const effectiveStance = (r: T) => r.stanceOverride || r.persona.stance || '';

  const forCamp: T[] = [];
  const againstCamp: T[] = [];
  const undecided: T[] = [];

  for (const r of rows) {
    const stance = effectiveStance(r);
    if (stance === STANCE_FOR) forCamp.push(r);
    else if (stance === STANCE_AGAINST) againstCamp.push(r);
    else undecided.push(r);
  }

  // Balance the camps with the undecided so neither side runs out early.
  undecided.forEach((r, i) => {
    (forCamp.length + (i % 2) <= againstCamp.length ? forCamp : againstCamp).push(r);
  });

  const ordered: T[] = [];
  for (let i = 0; i < Math.max(forCamp.length, againstCamp.length); i++) {
    if (forCamp[i]) ordered.push(forCamp[i]);
    if (againstCamp[i]) ordered.push(againstCamp[i]);
  }
  return ordered;
}

export const iterationService = {
  async runIteration(projectId: number): Promise<IterationResultDTO> {
    // Budget check before the slot and before the transaction: refusing on
    // spend must not first occupy a connection or make somebody else wait.
    await assertDailyBudget();

    return roundFlight(projectId, async () => {
      const release = await roundSlots.acquire(ROUND_SLOT_WAIT_MS);
      if (!release) {
        throw new TooManyRequestsError(
          `Сейчас выполняется ${env.llm.maxConcurrentRounds} раундов одновременно — это предел. ` +
          'Попробуйте через минуту.',
        );
      }

      try {
        return await withUsageContext({ projectId }, () =>
          iterationService._runIterationTransaction(projectId),
        );
      } finally {
        release();
      }
    });
  },

  async _runIterationTransaction(projectId: number): Promise<IterationResultDTO> {
    return prisma.$transaction(async (tx) => {
      // Transaction-scoped advisory lock (BUG-4 corrective fix, replacing
      // the session-scoped pg_try_advisory_lock/pg_advisory_unlock pair from
      // the original fix). That pair issued acquire and release as two
      // separate $queryRaw calls against the global `prisma` client — Prisma
      // pools connections and does not guarantee both calls land on the same
      // backend session, so under real concurrent load the unlock could
      // silently run on the wrong connection (proven live: pg_backend_pid()
      // differed between acquire/release, pg_advisory_unlock returned false,
      // and the lock stayed in pg_locks — sometimes even letting two
      // concurrent calls each see locked=true via same-session re-entrant
      // acquisition). pg_try_advisory_xact_lock, acquired here through `tx`,
      // is scoped to this transaction: Postgres releases it automatically on
      // COMMIT or ROLLBACK, on the single connection Prisma pins for the
      // whole `tx` callback — it cannot leak or land on a different session.
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${projectId}) AS locked
      `;
      if (!locked) {
        throw new ConflictError(`An iteration is already running for project ${projectId}`);
      }

      return iterationService._runIterationLocked(projectId, tx);
    }, { timeout: RUN_ITERATION_TX_TIMEOUT_MS });
  },

  async _runIterationLocked(projectId: number, tx: Prisma.TransactionClient): Promise<IterationResultDTO> {
    // 1. Fetch project with personas (all fields needed for LLM)
    const project = await tx.project.findUnique({
      where:   { id: projectId },
      include: {
        personas: {
          include:  { persona: true },
          orderBy:  { persona: { avatarIdx: 'asc' } },
        },
      },
    });

    // 2. Guards
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    if (project.personas.length === 0) throw new BadRequestError('No personas in project');
    if (!project.documentText) throw new BadRequestError('No document text');
    const discussionContext = buildDiscussionContext(project.documentText, project.subtitle);

    // 3. Determine next iteration
    const iteration = project.currentIteration + 1;
    if (iteration > project.iterations) throw new BadRequestError('Max iterations reached');

    // 4. Mark as running on first iteration
    if (project.status === 'setup') {
      await tx.project.update({ where: { id: projectId }, data: { status: 'running' } });
    }

    // 5. Fetch full discussion history — replies must build on prior iterations,
    // not just on messages generated within this one run. Project existence
    // was already validated above (step 1/2), so this goes straight to the
    // repository (through `tx`) rather than discussionService.getTimeline(),
    // which would re-check existence via the global (non-transactional) client.
    const historyRows = await discussionRepository.findTimeline(projectId, tx);
    const history = historyRows.map(toTimelineDTO);

    // 6. Generate and save one reply per persona (sequentially so context builds up)
    const messages: TimelineMessageDTO[] = [];

    const goalLabel = GOAL_LABELS[project.goal] ?? project.goal ?? 'Обсуждение документа';

    const saveMessage = async (text: string, personaId?: number) => {
      const n = await discussionRepository.nextN(projectId, tx);
      const row = await discussionRepository.createTimelineMessage({
        projectId,
        ...(personaId !== undefined && { personaId }),
        speakerType: personaId === undefined ? 'moderator' : 'persona',
        n,
        text,
        iteration,
        time: new Date().toTimeString().slice(0, 8),
      }, tx);
      messages.push(toTimelineDTO(row));
      return row;
    };

    // In interview mode the moderator opens the round: personas answer one
    // specific question instead of reacting to the room, so the question has to
    // exist before the first persona speaks. Every other mode keeps the
    // moderator as the closing turn (step 7).
    let interviewQuestion: string | undefined;
    if (project.mode === MODE_INTERVIEW && project.moderator) {
      const soFar = history.map((m) => `${m.name}: ${m.text}`);
      interviewQuestion = await generateModeratorMessage(
        soFar, discussionContext, goalLabel, project.intendedMessages,
      );
      await saveMessage(interviewQuestion);
    }

    const speakingOrder = project.mode === MODE_DEBATE
      ? debateOrder(project.personas)
      : project.personas;

    for (const pp of speakingOrder) {
      // Per-discussion overrides (stance chosen in SetupPage, plus
      // reasoning/priority/fears/thinking derived from the actual document by
      // generatePersonaDocumentPositions at project creation) take precedence
      // over the persona's own library-wide defaults.
      const persona = {
        ...pp.persona,
        ...(pp.stanceOverride    && { stance:    pp.stanceOverride }),
        ...(pp.reasoningOverride && { reasoning: pp.reasoningOverride }),
        ...(pp.priorityOverride  && { priority:  pp.priorityOverride }),
        ...(pp.fearsOverride     && { fears:     pp.fearsOverride }),
        ...(pp.thinkingOverride  && { thinking:  pp.thinkingOverride }),
      };
      const previousMessages = [...history, ...messages].map((m) => ({ speaker: m.name, text: m.text }));

      // Debate: the person to answer is the last persona who spoke this round —
      // the alternating order above guarantees they are from the other camp.
      const lastPersonaThisRound = [...messages].reverse()
        .find((m) => m.speakerType === 'persona');

      const text = await generatePersonaResponse(
        persona,
        discussionContext,
        previousMessages,
        iteration,
        {
          goal: project.goal,
          mode: project.mode,
          ...(project.mode === MODE_DEBATE && lastPersonaThisRound && {
            opponent: lastPersonaThisRound.name,
          }),
          ...(interviewQuestion && { question: interviewQuestion }),
        },
      );

      await saveMessage(text, persona.id);
    }

    // 7. Moderator closing question (if enabled, and unless it already opened
    // the round in interview mode — one moderator turn per round either way).
    if (project.moderator && interviewQuestion === undefined) {
      const lastMessages = [...history, ...messages].map((m) => `${m.name}: ${m.text}`);
      const text = await generateModeratorMessage(
        lastMessages, discussionContext, goalLabel, project.intendedMessages,
      );
      await saveMessage(text);
    }

    // 8. Persist new iteration counter, and mark the project completed once
    // the configured limit is reached — nothing previously transitioned
    // status past 'running', so a project that had actually finished all
    // its iterations still read back as "in progress" from GET /projects
    // (and the frontend's Отчёт tab had no signal to tell "still running"
    // apart from "done, report not generated yet").
    await tx.project.update({
      where: { id: projectId },
      data:  {
        currentIteration: iteration,
        ...(iteration >= project.iterations && { status: 'completed' }),
      },
    });

    return {
      currentIteration: iteration,
      status: iteration >= project.iterations ? 'completed' : 'running',
      messages,
    };
  },
};
