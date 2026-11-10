import { projectRepository, ProjectWithCount, ProjectWithPersonas, PersonaCreateOverrides } from '../repositories/project.repository';
import { personaRepository } from '../repositories/persona.repository';
import { personaToDTO, PersonaDTO } from './persona.service';
import { generatePersonaDocumentPositions, buildDiscussionContext } from './llm.service';
import { NotFoundError, ConflictError } from '../utils/errors';
import { MAX_PERSONAS_PER_PROJECT } from '../config/limits';
import { env } from '../config/env';
import { discardStoredDocument } from '../utils/uploadFiles';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import { assertDocumentFitsWindow } from './promptBudget';
import {
  CreateProjectInput,
  UpdateProjectInput,
  AddPersonaToProjectInput,
} from '../validators/project.validator';
import { Project } from '@prisma/client';

// ─── DTOs ────────────────────────────────────────────────────

export interface ProjectListDTO {
  id: number;
  title: string;
  subtitle: string;
  status: string;
  mode: string;
  iterations: number;
  currentIteration: number;
  moderator: boolean;
  goal: string;
  llmModel: string;
  personaCount: number;
  // Preview faces for the projects list (up to 5); personaCount stays the
  // authoritative total.
  personas: {
    id: number; name: string; dot: string;
    avatarIdx: number; gender: string; look: unknown;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailDTO extends Omit<ProjectListDTO, 'personaCount'> {
  intendedMessages: string[];
  // A1 stage 2. publishedAt as YYYY-MM-DD; intendedAudience [] = not set.
  docType: string | null;
  publishedAt: string | null;
  intendedAudience: string[];
  documentText: string | null;
  documentFile: string | null;
  documentFileName: string | null;
  personas: PersonaDTO[];
}

// ─── Presenters ──────────────────────────────────────────────

function effectiveStatus(p: Pick<Project, 'status' | 'currentIteration' | 'iterations'>): string {
  // Older simulations may already have reached their configured limit while
  // still carrying the legacy running value. Treat completion as a durable
  // invariant of the persisted counters so reloads recover correctly too.
  return p.currentIteration >= p.iterations ? 'completed' : p.status;
}

function toListDTO(p: ProjectWithCount): ProjectListDTO {
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    status: effectiveStatus(p),
    mode: p.mode,
    iterations: p.iterations,
    currentIteration: p.currentIteration,
    moderator: p.moderator,
    goal: p.goal,
    llmModel: p.llmModel,
    personaCount: p._count.personas,
    personas: p.personas.map((pp) => pp.persona),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toDetailDTO(p: ProjectWithPersonas): ProjectDetailDTO {
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    status: effectiveStatus(p),
    mode: p.mode,
    iterations: p.iterations,
    currentIteration: p.currentIteration,
    moderator: p.moderator,
    goal: p.goal,
    llmModel: p.llmModel,
    intendedMessages: p.intendedMessages,
    docType: p.docType ?? null,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : null,
    intendedAudience: p.intendedAudience ?? [],
    documentText: p.documentText ?? null,
    documentFile: p.documentFile ?? null,
    documentFileName: p.documentFileName ?? null,
    personas: p.personas.map((pp) => personaToDTO(pp.persona, {
      stance:    pp.stanceOverride,
      reasoning: pp.reasoningOverride,
      priority:  pp.priorityOverride,
      fears:     pp.fearsOverride,
      thinking:  pp.thinkingOverride,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────

type DocumentMetaInput = Pick<CreateProjectInput, 'docType' | 'publishedAt' | 'intendedAudience'>;

/**
 * The document fields as columns (A1 stage 2). null clears a field; on PATCH
 * (`partial`) an omitted field stays out, so it is not touched. The audience
 * is stored as sent, deduplicated — the default per type is the UI's.
 */
function documentMetaData(m: DocumentMetaInput, partial = false): Partial<Pick<Project, 'docType' | 'publishedAt' | 'intendedAudience'>> {
  const out: Partial<Pick<Project, 'docType' | 'publishedAt' | 'intendedAudience'>> = {};
  if (!partial || m.docType !== undefined) out.docType = m.docType ?? null;
  if (!partial || m.publishedAt !== undefined) out.publishedAt = m.publishedAt ? new Date(`${m.publishedAt}T00:00:00Z`) : null;
  if (!partial || m.intendedAudience !== undefined) out.intendedAudience = [...new Set(m.intendedAudience ?? [])];
  return out;
}


async function assertProject(id: number): Promise<ProjectWithPersonas> {
  const project = await projectRepository.findById(id);
  if (!project) throw new NotFoundError(`Project with id ${id} not found`);
  return project;
}

// ─── Service ─────────────────────────────────────────────────

export const projectService = {
  async getAll(ownerKey?: string): Promise<ProjectListDTO[]> {
    const rows = await projectRepository.findAll(ownerKey);
    return rows.map(toListDTO);
  },

  async getById(id: number): Promise<ProjectDetailDTO> {
    const project = await assertProject(id);
    return toDetailDTO(project);
  },

  async create(input: CreateProjectInput, ownerKey?: string): Promise<ProjectDetailDTO> {
    const { personaIds: requestedIds, ...data } = input;

    // First, before any persona lookup or LLM call: a document no persona can
    // read whole is refused outright, so no tokens are spent on positions for a
    // project that cannot run (A1 stage 0).
    assertDocumentFitsWindow(data.documentText);

    // Deduplicated here rather than rejected (SECURITY.md item 27). The same id
    // twice used to reach ProjectPersona's unique (projectId, personaId) and
    // come back as a 500 — a client mistake reported as a server fault. There
    // is only one sensible reading of "these two personas, and that one again",
    // and the result is identical to the request minus the repetition, so a
    // 400 would be pedantry.
    //
    // The .max() in CreateProjectSchema still counts the raw array: the cap
    // exists to bound a request's size, and loosening it to count uniques would
    // be a behaviour change dressed as a bug fix.
    const personaIds = [...new Set(requestedIds)];

    // Validate all persona IDs exist, keeping the fetched rows — reused below
    // to derive per-document positions instead of re-querying.
    const personas = await Promise.all(
      personaIds.map(async (pid) => {
        const p = await personaRepository.findById(pid);
        if (!p) throw new NotFoundError(`Persona with id ${pid} not found`);
        return p;
      }),
    );

    const projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
      title: data.title,
      subtitle: data.subtitle,
      mode: data.mode,
      iterations: data.iterations,
      currentIteration: data.currentIteration,
      moderator: data.moderator,
      goal: data.goal,
      intendedMessages: data.intendedMessages,
      status: 'setup',
      // Written by the server, not accepted from the request (SECURITY.md
      // item 28). This column is what the report page shows as the model
      // behind the analysis, and every call in llm.service.ts goes to
      // env.llmModel — so these have to be the same value or the label is
      // decoration. Recorded at creation and never updated: it answers "what
      // was configured when this project ran", which is the honest question,
      // and the per-call truth is in LlmUsage.model.
      llmModel: env.llmModel,
      documentText: data.documentText ?? null,
      documentFile: data.documentFile ?? null,
      documentFileName: data.documentFileName ?? null,
      ownerKey: ownerKey ?? null,
      // Not partial: every field is set, null when absent.
      ...(documentMetaData(data) as Pick<Project, 'docType' | 'publishedAt' | 'intendedAudience'>),
    };

    // Persona.reasoning/priority/fears/thinking are seeded once and otherwise
    // stay fixed for every document a persona is ever used with. Derive a
    // per-project override from the actual document text so the discussion
    // argues about what's really in it, not whatever the seed persona was
    // originally written for. Best-effort: a broken/unavailable LLM call
    // must not block project creation, so fall back to no overrides.
    let personaOverrides: Record<string, PersonaCreateOverrides> = {};
    // Hoisted out of the condition: inside the closure below TypeScript no
    // longer trusts the narrowing from `if (data.documentText && ...)`, because
    // `data` could in principle be mutated before the callback runs.
    const documentText = data.documentText;
    if (documentText && personas.length > 0) {
      try {
        // The project row does not exist yet, so this spend is recorded with
        // projectId null. Budget is checked here rather than inside the
        // generator, which must keep falling back to persona defaults.
        await assertDailyBudget();
        const positions = await withUsageContext({}, () => generatePersonaDocumentPositions(
          buildDiscussionContext(documentText, data.subtitle),
          personas.map((p) => ({
            id: p.id, name: p.name, role: p.role,
            city: p.city, education: p.education,
            industry: p.industry, employerType: p.employerType, income: p.income,
            openness: p.openness, decisionMaking: p.decisionMaking,
            personalSituation: p.personalSituation, interests: p.interests,
            stance: p.stance,
          })),
        ));
        personaOverrides = Object.fromEntries(
          positions.map((pos) => [String(pos.id), {
            stance: pos.stance, reasoning: pos.reasoning,
            priority: pos.priority, fears: pos.fears, thinking: pos.thinking,
          }]),
        );
      } catch (err) {
        console.error('[Project] generatePersonaDocumentPositions failed, using persona defaults:', err);
      }
    }

    const project = await projectRepository.create(projectData, personaIds, input.personaStances, personaOverrides);
    return toDetailDTO(project);
  },

  async update(id: number, input: UpdateProjectInput): Promise<ProjectDetailDTO> {
    await assertProject(id);
    assertDocumentFitsWindow(input.documentText);
    const { docType, publishedAt, intendedAudience, ...rest } = input;
    const project = await projectRepository.update(id, { ...rest, ...documentMetaData({ docType, publishedAt, intendedAudience }, true) });
    return toDetailDTO(project);
  },

  async delete(id: number): Promise<void> {
    const project = await assertProject(id);

    // Child rows cascade, the file on disk does not. Uploads created before
    // documents now delete their own file after extraction still have one, so
    // deleting a project has to take it with them — otherwise the volume keeps
    // documents belonging to projects that no longer exist.
    //
    // Order matters: unlink first, because a failed delete of the project row
    // must not leave the row pointing at a file that is already gone.
    // discardStoredDocument never throws, so it cannot block the delete.
    await discardStoredDocument(project.documentFile);
    await projectRepository.delete(id);
  },

  // ─── Persona sub-resource ──────────────────────────────────

  async getPersonas(projectId: number): Promise<PersonaDTO[]> {
    await assertProject(projectId);
    const rows = await projectRepository.findPersonas(projectId);
    return rows.map((r) => personaToDTO(r.persona, {
      stance:    r.stanceOverride,
      reasoning: r.reasoningOverride,
      priority:  r.priorityOverride,
      fears:     r.fearsOverride,
      thinking:  r.thinkingOverride,
    }));
  },

  async addPersona(projectId: number, input: AddPersonaToProjectInput): Promise<PersonaDTO[]> {
    await assertProject(projectId);

    const persona = await personaRepository.findById(input.personaId);
    if (!persona) throw new NotFoundError(`Persona with id ${input.personaId} not found`);

    const existing = await projectRepository.findProjectPersona(projectId, input.personaId);
    if (existing) throw new ConflictError(`Persona ${input.personaId} is already in project ${projectId}`);

    // The same cap CreateProjectSchema puts on personaIds. Without it here the
    // array limit is decorative: this route reaches the identical state one
    // persona at a time, and each added persona is another LLM call in every
    // subsequent round. (A concurrent pair of adds can overshoot by one — the
    // cap bounds cost, it is not a correctness invariant like the round's
    // advisory lock.)
    const current = await projectRepository.findPersonas(projectId);
    if (current.length >= MAX_PERSONAS_PER_PROJECT) {
      throw new ConflictError(
        `Project ${projectId} already has the maximum of ${MAX_PERSONAS_PER_PROJECT} personas`,
      );
    }

    await projectRepository.addPersona(projectId, input.personaId, input.stance || null);
    const rows = await projectRepository.findPersonas(projectId);
    return rows.map((r) => personaToDTO(r.persona, {
      stance:    r.stanceOverride,
      reasoning: r.reasoningOverride,
      priority:  r.priorityOverride,
      fears:     r.fearsOverride,
      thinking:  r.thinkingOverride,
    }));
  },

  async removePersona(projectId: number, personaId: number): Promise<PersonaDTO[]> {
    await assertProject(projectId);

    // Removing the last persona would leave the project unable to run any
    // discussion iteration (see iteration.service.ts's "No personas in
    // project" guard) with no UI recovery path — reject it instead (BUG-3).
    const result = await projectRepository.removePersonaGuarded(projectId, personaId);
    if (result === 'not_found') throw new NotFoundError(`Persona ${personaId} is not in project ${projectId}`);
    if (result === 'last_persona') {
      throw new ConflictError(`Cannot remove persona ${personaId}: project ${projectId} would be left with no personas`);
    }

    const rows = await projectRepository.findPersonas(projectId);
    return rows.map((r) => personaToDTO(r.persona, {
      stance:    r.stanceOverride,
      reasoning: r.reasoningOverride,
      priority:  r.priorityOverride,
      fears:     r.fearsOverride,
      thinking:  r.thinkingOverride,
    }));
  },
};
