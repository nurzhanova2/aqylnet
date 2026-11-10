import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { TooManyRequestsError } from '../utils/errors';

// Token accounting and the daily ceiling (SECURITY.md item 17, plus the counted
// quota that item 4 needed on top of a frequency limit).
//
// The frequency limiters from stage E1 bound how *often* the LLM can be called.
// They say nothing about what it costs: a round is one request but up to nine
// completions, and a report is two with max_tokens 1400 and 4000. Before this
// file the service had no idea what it spent on a shared NBK quota.

/**
 * The LLM scenarios, as they are recorded. `alignment` — the
 * intended-vs-perceived check — rode inside document_audit until the audit went
 * per section (A1 stage 0); it is its own row now, so the audit's cost is the
 * sections' cost and nothing else.
 */
export type LlmScenario =
  | 'suggest_personas'
  | 'persona_positions'
  | 'persona_response'
  | 'moderator_message'
  | 'discussion_report'
  | 'document_audit'
  | 'alignment'
  // A1 stage 0a: the absences checklist and the contradiction search, each its
  // own row so the audit's cost can be read part by part.
  | 'audit_checklist'
  | 'audit_contradictions'
  // A1 stage 1: one persona scoring the document section by section.
  | 'persona_score'
  // A1 stage 2: the decision reference, the verdicts on the personas'
  // decision answers, and the missing explanations of one group.
  | 'decision_reference'
  | 'decision_verdict'
  | 'missing_explanations'
  // A1 stage 3: the card, the brief, the full text's summary and its edits
  // by section.
  | 'rewrite_card'
  | 'rewrite_brief'
  | 'rewrite_bluf'
  | 'rewrite_section';

interface UsageContext {
  projectId?: number;
}

// Request-scoped so the six generator functions in llm.service.ts do not each
// need a projectId parameter threaded through them and through every caller.
// The alternative — changing six signatures and their call sites — buys nothing
// except more places to forget.
const store = new AsyncLocalStorage<UsageContext>();

/** Runs `fn` with a usage context, so completions inside it are attributed. */
export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** The parts of a completion this module reads. */
interface UsageSource {
  usage?: CompletionUsage | null;
  /**
   * What the proxy says served the request.
   *
   * Recorded in preference to env.llmModel because the new tokens address
   * models through *capability aliases* — `assistant-balanced` names a role,
   * not a model, and the administrators can repoint it at a different engine
   * without anyone changing configuration. Storing the configured name would
   * then record the alias forever and lose what actually ran. Today the proxy
   * echoes back whatever was sent, so this is no worse; if it ever resolves the
   * alias, the accounting captures it.
   */
  model?: string | null;
}

/**
 * Records one completion's token usage.
 *
 * Never throws and never blocks the caller's result. Losing an accounting row
 * must not fail a generation the user already paid for — and in particular
 * generateModeratorMessage must stay non-throwing (BUG-5: if it throws, the
 * round counter desynchronises from the transcript).
 */
export interface UsageMeta {
  /** Version of the scenario's prompt (LlmUsage.scenarioVersion). */
  version?: string;
  /** Hash of the prompt with the fence tag masked (LlmUsage.promptHash). */
  promptHash?: string;
}

export function recordUsage(scenario: LlmScenario, source: UsageSource | undefined | null, meta: UsageMeta = {}): void {
  const usage = source?.usage;
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const total = usage?.total_tokens ?? prompt + completion;

  // A proxy that reports no usage at all would otherwise fill the table with
  // zero rows that only obscure the real figures.
  if (total <= 0) return;

  const projectId = store.getStore()?.projectId;

  void prisma.llmUsage
    .create({
      data: {
        ...(projectId !== undefined && { projectId }),
        scenario,
        model: source?.model || env.llmModel,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
        ...(meta.version && { scenarioVersion: meta.version }),
        ...(meta.promptHash && { promptHash: meta.promptHash }),
      },
    })
    .catch((err: unknown) => {
      console.error('[llmUsage] could not record usage:', err);
    });
}

function startOfDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface DailySpend {
  totalTokens: number;
  suggestCalls: number;
  since: Date;
}

/** Today's totals, for the budget check and for reporting. */
export async function dailySpend(): Promise<DailySpend> {
  const since = startOfDayUtc();

  const [totals, suggestCalls] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true },
    }),
    prisma.llmUsage.count({
      where: { createdAt: { gte: since }, scenario: 'suggest_personas' },
    }),
  ]);

  return {
    totalTokens: totals._sum.totalTokens ?? 0,
    suggestCalls,
    since,
  };
}

/**
 * Refuses the request when today's spend is already at the ceiling.
 *
 * Called once per API request that is about to spend tokens, not once per
 * completion: a round makes nine calls, and checking before each would add nine
 * round-trips to buy granularity nobody needs. The consequence is that the last
 * request of the day can overshoot the cap by one round — a bounded overshoot is
 * the price of not making the check itself expensive, and is recorded honestly
 * here rather than pretended away.
 *
 * `scenario` narrows the check to a per-scenario quota where one exists.
 */
export async function assertDailyBudget(scenario?: LlmScenario): Promise<void> {
  const spend = await dailySpend();

  if (spend.totalTokens >= env.llm.dailyTokenBudget) {
    throw new TooManyRequestsError(
      'Суточный лимит обращений к модели исчерпан ' +
      `(${spend.totalTokens.toLocaleString('ru-RU')} токенов). ` +
      'Работа продолжится после полуночи UTC или после повышения лимита.',
    );
  }

  if (scenario === 'suggest_personas' && spend.suggestCalls >= env.llm.dailySuggestCalls) {
    throw new TooManyRequestsError(
      `Суточная квота на авто-подбор персон исчерпана (${spend.suggestCalls} вызовов). ` +
      'Выберите участников вручную или повторите после полуночи UTC.',
    );
  }
}
