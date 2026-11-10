// Persona groups (A1 stage 1), approved 03.11.2026 — see .ai/PERSONA-GROUPS.md.
//
// The rule: a group is a persona's ROLE IN FORMING EXPECTATIONS, not its level
// of knowledge.
//   population — decides for itself (its deposit, loan, pension, purchases);
//   business   — sets its own prices, buys, invests;
//   experts    — interprets NBK decisions and passes them on to others
//                (bankers, economists, officials, journalists, deputies,
//                lawyers, financial bloggers). Shown in the UI as
//                «Эксперты и посредники».
//
// This map fills Persona.group for the library that existed before the column
// (scripts/backfillPersonaGroups.ts), by name. prisma/seed.ts carries the same
// groups inline for a fresh database — it is compiled on its own and imports
// nothing from src — and personaGroups.test.ts keeps the two in step.

export const PERSONA_GROUPS = ['population', 'business', 'experts'] as const;
export type PersonaGroupKey = typeof PERSONA_GROUPS[number];

export const GROUP_BY_NAME: Readonly<Record<string, PersonaGroupKey>> = {
  // population — 16
  'Гульнар': 'population',
  'Данияр': 'population',
  'Светлана': 'population',
  'Бауыржан': 'population',
  'Асхат': 'population',
  'Нурлан': 'population',
  'Назгуль': 'population',
  'Сабина': 'population',
  'Жулдыз': 'population',
  'Балжан': 'population',
  'Аружан': 'population',
  'Алия': 'population',
  'Жанар': 'population',
  'Айдос': 'population',
  'Тимур': 'population',
  'Дамир': 'population',
  // business — 6
  'Максат': 'business',
  'Сейткали': 'business',
  'Нургуль': 'business',
  'Камила': 'business',
  'Қайрат': 'business',
  'Айгерим': 'business',
  // experts — 12
  'Ерлан': 'experts',
  'Зауреш': 'experts',
  'Руслан': 'experts',
  'Жандос': 'experts',
  'Арман': 'experts',
  'Санжар': 'experts',
  'Куляш': 'experts',
  'Джессика': 'experts',
  'Мухтар': 'experts',
  'Алинур': 'experts',
  'Меруерт': 'experts',
  'Даниэль Хартманн': 'experts',
};

/**
 * Group names for phrases the code builds (A1 stage 2): nominative and
 * genitive («писали для населения»). The UI has its own copy of the
 * nominative labels (aqylnet/src/utils/personaGroups.js) — keep them equal.
 */
export const GROUP_LABELS: Readonly<Record<PersonaGroupKey, { nom: string; gen: string }>> = {
  population: { nom: 'население', gen: 'населения' },
  business: { nom: 'бизнес', gen: 'бизнеса' },
  experts: { nom: 'эксперты и посредники', gen: 'экспертов и посредников' },
};
