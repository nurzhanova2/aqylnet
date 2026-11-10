import { z } from 'zod';
import { MAX_AVATAR_IDX } from '../config/limits';
import { PERSONA_GROUPS } from '../config/personaGroups';

const ContextSchema = z.object({
  src:   z.string().min(1),
  quote: z.string().min(1),
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Параметры чиби-аватара (UI-атрибут, см. Persona.look)
export const LookSchema = z.object({
  skin:    z.string().regex(HEX_COLOR, 'skin must be a hex color, e.g. #F6D2B8'),
  hair:    z.string().regex(HEX_COLOR, 'hair must be a hex color, e.g. #2A1C17'),
  outfit:  z.string().regex(HEX_COLOR, 'outfit must be a hex color, e.g. #7C5CC4'),
  style:   z.enum(['short', 'long', 'bob', 'bun', 'spiky']),
  glasses: z.boolean().optional(),
});

export type LookInput = z.infer<typeof LookSchema>;

export const CreatePersonaSchema = z.object({
  // ── Базовые (обязательные) ──────────────────────────────────────
  name:         z.string().min(1),
  role:         z.string().min(1),
  gender:       z.string().min(1),
  age:          z.string().min(1),
  dot:          z.string().regex(/^#[0-9a-fA-F]{6}$/, 'dot must be a hex color, e.g. #34d399'),
  style:        z.string().min(1),
  criticality:  z.string().min(1),
  behaviorModel: z.string().min(1),

  // ── Демография ─────────────────────────────────────────────────
  city:      z.string().default(''),
  education: z.string().default(''),

  // ── Профессия ──────────────────────────────────────────────────
  industry:     z.string().default(''),
  employerType: z.string().default(''),
  income:       z.string().default(''),

  // ── Психологический профиль ────────────────────────────────────
  openness:      z.string().default(''),
  decisionMaking: z.string().default(''),

  // ── Позиция по теме ────────────────────────────────────────────
  stance:           z.string().default(''),
  priority:         z.string().default(''),
  fears:            z.string().default(''),
  personalSituation: z.string().default(''),

  // ── Стиль речи (LLM-промпт) ────────────────────────────────────
  speechTone:     z.string().default(''),
  argumentation:  z.string().default(''),
  responseLength: z.string().default('Средний'),
  typicalPhrases: z.string().default(''),

  // ── AI-контент ─────────────────────────────────────────────────
  thinking:  z.string().default(''),
  reasoning: z.string().default(''),
  interests: z.array(z.string()).default([]),
  // 0–MAX_AVATAR_IDX: seed создаёт персон с avatarIdx до 33 — меньший лимит
  // отклонял бы PATCH существующих персон, возвращающий их собственный avatarIdx.
  avatarIdx: z.number().int().min(0).max(MAX_AVATAR_IDX).default(0),
  look:      LookSchema.nullish().default(null),

  // Роль в формировании ожиданий (config/personaGroups.ts): population |
  // business | experts. null — группа ещё не выбрана.
  group:     z.enum(PERSONA_GROUPS).nullish().default(null),

  // ── Сцена / позиция ────────────────────────────────────────────
  seatL: z.string().default('50%'),
  seatT: z.string().default('50%'),

  // ── Контекст из документа ──────────────────────────────────────
  contexts: z.array(ContextSchema).default([]),
});

// PATCH must mean "only what was sent", and under zod 4 `.partial()` alone no
// longer means that.
//
// In zod 3 an absent key short-circuited at the optional wrapper and the
// field's `.default()` never ran, so `CreatePersonaSchema.partial()` produced
// undefined for everything unsent and the repository left those columns alone.
// Zod 4 runs the default first, so every one of the 23 defaulted fields arrived
// at the repository carrying its default value. Measured on the live API before
// this fix: `PATCH /personas/:id` with `{ name }` rewrote **20 of 22** columns —
// city, education, industry, stance, priority, fears, interests and the chibi
// avatar all reset, from a request that named none of them. Nothing in the
// suites covered it; persona_update.test.ts does now.
//
// So the defaults are unwrapped rather than hidden behind an optional. The
// field's own validation survives — a number in `city` is still a 400 — and
// `look` keeps its three-way contract: absent means "leave it", explicit null
// means "clear it" (see repositories/persona.repository.ts toLookWrite).
type StripDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;

type UpdatePersonaShape = {
  [K in keyof typeof CreatePersonaSchema.shape]:
    z.ZodOptional<StripDefault<typeof CreatePersonaSchema.shape[K]>>;
};

const updatePersonaShape = Object.fromEntries(
  Object.entries(CreatePersonaSchema.shape).map(([key, field]) => [
    key,
    (field instanceof z.ZodDefault ? field.unwrap() : field).optional(),
  ]),
) as UpdatePersonaShape;

export const UpdatePersonaSchema = z.object(updatePersonaShape);

export type CreatePersonaInput = z.infer<typeof CreatePersonaSchema>;
export type UpdatePersonaInput = z.infer<typeof UpdatePersonaSchema>;
