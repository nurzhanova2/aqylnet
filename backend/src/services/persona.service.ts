import { personaRepository, PersonaWithContexts } from '../repositories/persona.repository';
import { NotFoundError, ConflictError } from '../utils/errors';
import { CreatePersonaInput, UpdatePersonaInput, LookInput } from '../validators/persona.validator';

// ─── DTO ─────────────────────────────────────────────────────
export interface PersonaDTO {
  id:       number;
  name:     string;
  role:     string;
  gender:   string;
  age:      string;
  dot:      string;
  seat:     { l: string; t: string };
  tagAnchor: string;
  thinking:  string;
  style:     string;
  criticality: string;
  model:    string;       // mapped from behaviorModel
  interests: string[];
  reasoning: string;
  avatarIdx: number;
  look:      LookInput | null;   // параметры чиби-аватара (UI-атрибут)
  context:  { src: string; quote: string }[];

  // ── Демография ────────────────────────────────────
  city:      string;
  education: string;

  // ── Профессия ─────────────────────────────────────
  industry:     string;
  employerType: string;
  income:       string;
  // ── Группа (роль в формировании ожиданий) ─────────
  group:        'population' | 'business' | 'experts' | null;

  // ── Психологический профиль ───────────────────────
  openness:      string;
  decisionMaking: string;

  // ── Позиция по теме ───────────────────────────────
  stance:            string;
  priority:          string;
  fears:             string;
  personalSituation: string;

  // ── Стиль речи ────────────────────────────────────
  speechTone:     string;
  argumentation:  string;
  responseLength: string;
  typicalPhrases: string;
}

// Per-project overrides generated from the actual uploaded document (see
// llm.service.ts generatePersonaDocumentPositions) — take precedence over the
// persona's own library-wide defaults when set. `stance` can also come from
// an explicit user pick made in SetupPage (ProjectPersona.stanceOverride),
// which is resolved by the caller before reaching this function.
export interface PersonaOverrides {
  stance?:    string | null;
  reasoning?: string | null;
  priority?:  string | null;
  fears?:     string | null;
  thinking?:  string | null;
}

export function personaToDTO(p: PersonaWithContexts, overrides: PersonaOverrides = {}): PersonaDTO {
  return {
    id:         p.id,
    name:       p.name,
    role:       p.role,
    gender:     p.gender,
    age:        p.age,
    dot:        p.dot,
    seat:       { l: p.seatL, t: p.seatT },
    tagAnchor:  'bottom',
    thinking:   overrides.thinking || p.thinking,
    style:      p.style,
    criticality: p.criticality,
    model:      p.behaviorModel,
    interests:  p.interests,
    reasoning:  overrides.reasoning || p.reasoning,
    avatarIdx:  p.avatarIdx,
    look:       (p.look ?? null) as LookInput | null,
    context:    p.contexts.map((c) => ({ src: c.src, quote: c.quote })),

    city:      p.city,
    education: p.education,

    industry:     p.industry,
    employerType: p.employerType,
    income:       p.income,
    group:        p.group ?? null,

    openness:      p.openness,
    decisionMaking: p.decisionMaking,

    stance:            overrides.stance || p.stance,
    priority:          overrides.priority || p.priority,
    fears:             overrides.fears || p.fears,
    personalSituation: p.personalSituation,

    speechTone:     p.speechTone,
    argumentation:  p.argumentation,
    responseLength: p.responseLength,
    typicalPhrases: p.typicalPhrases,
  };
}

// ─── Service ─────────────────────────────────────────────────
export const personaService = {
  async getAll(): Promise<PersonaDTO[]> {
    const rows = await personaRepository.findAll();
    return rows.map((r) => personaToDTO(r));
  },

  async getById(id: number): Promise<PersonaDTO> {
    const row = await personaRepository.findById(id);
    if (!row) throw new NotFoundError(`Persona with id ${id} not found`);
    return personaToDTO(row);
  },

  async create(input: CreatePersonaInput): Promise<PersonaDTO> {
    const { contexts, ...data } = input;
    const existing = await personaRepository.findByName(data.name);
    if (existing) {
      throw new ConflictError(`Persona with name "${data.name}" already exists`);
    }
    const row = await personaRepository.create(data, contexts);
    return personaToDTO(row);
  },

  async update(id: number, input: UpdatePersonaInput): Promise<PersonaDTO> {
    await personaService.getById(id);
    const { contexts, ...data } = input;
    if (data.name !== undefined) {
      const existing = await personaRepository.findByName(data.name);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Persona with name "${data.name}" already exists`);
      }
    }
    const row = await personaRepository.update(id, data, contexts);
    return personaToDTO(row);
  },

  async delete(id: number): Promise<void> {
    await personaService.getById(id);

    // The library is shared by design (projects are scoped by workspace, personas are not),
    // so a delete here reaches into every project that ever used the persona —
    // including other workspaces, which no session key scopes. Each relation
    // fails differently, so each is reported separately rather than as one
    // vague conflict.
    //
    // There were three checks; the Dialog one went with the model it guarded
    // (SECURITY.md item 34). It could never fire: nothing ever wrote a Dialog
    // row, so a persona could not be referenced by one.
    if (await personaRepository.hasTimelineReferences(id)) {
      throw new ConflictError(
        `Persona ${id} has already spoken in a discussion and cannot be deleted`,
      );
    }
    if (await personaRepository.hasProjectReferences(id)) {
      throw new ConflictError(
        `Persona ${id} is part of an existing project's cast and cannot be deleted`,
      );
    }

    await personaRepository.delete(id);
  },
};
