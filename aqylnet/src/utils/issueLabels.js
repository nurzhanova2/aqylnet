// What an audit issue's severity and category are called on the page and in
// every export. The data keeps the schema's English keys (Critical | High |
// Medium | Low; readability, terminology, …); the reader sees Russian, as
// everywhere else in the interface — the export used to print the raw keys.

export const SEVERITY_LABELS = {
  Critical: 'Критичное',
  High: 'Высокое',
  Medium: 'Среднее',
  Low: 'Низкое',
};

export const CATEGORY_LABELS = {
  readability: 'читаемость',
  terminology: 'терминология',
  ambiguity:   'неоднозначность',
  context:     'контекст',
  logic:       'логика',
  evidence:    'доказательность',
  data:        'данные',
  structure:   'структура',
  audience:    'аудитория',
};

/** The reader's word for a severity key; an unknown key is shown as it is. */
export function severityLabel(key) {
  return SEVERITY_LABELS[key] ?? key;
}

/** The reader's word for a category key; an unknown key is shown as it is. */
export function categoryLabel(key) {
  return CATEGORY_LABELS[key] ?? key;
}

const MODERATOR = 'Модератор';
const names = (raw) => String(raw || '').split(',').map((n) => n.trim()).filter(Boolean);

/**
 * Who raised, agreed with and disputed an issue. The model fills the three
 * lists separately and often names the same person twice, or the moderator,
 * who is not a member of the group: each person is kept once, under the first
 * list that names them.
 */
export function issuePeople(issue) {
  const raised = names(issue?.raisedBy).filter((n) => n !== MODERATOR);
  const rest = (raw) => names(raw).filter((n) => n !== MODERATOR && !raised.includes(n));
  return { raised, agreed: rest(issue?.agreedBy), disputed: rest(issue?.disputedBy) };
}
