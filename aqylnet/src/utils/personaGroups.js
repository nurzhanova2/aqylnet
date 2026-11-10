// Persona groups (A1 stage 1) — the role in forming expectations, not the level
// of knowledge: population decides for itself; business sets prices, buys and
// invests; experts interpret NBK decisions and pass them on. The keys are the
// backend's (config/personaGroups.ts); the labels are product wording.

export const PERSONA_GROUPS = ['population', 'business', 'experts'];

export const GROUP_LABELS = {
  population: 'Население',
  business: 'Бизнес',
  experts: 'Эксперты и посредники',
};

export const GROUP_HINTS = {
  population: 'решает за себя: вклад, кредит, пенсия, покупки',
  business: 'сам ставит цены, закупает, инвестирует',
  experts: 'толкует решения НБК и передаёт другим',
};

export function groupLabel(group) {
  return GROUP_LABELS[group] ?? 'Группа не задана';
}
