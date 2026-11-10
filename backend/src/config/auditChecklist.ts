// Questions the audit asks of the whole document (A1 stage 0a).
//
// The section audit finds what is *wrong* with text that is there; it cannot
// find what is missing, because it is told to quote, and an absence has no
// quote. Measured: neither the hidden decision nor the missing "what this means
// for depositors" was found by any audit variant (MEASUREMENTS-15PAGES §5.2).
// So absences are asked about directly, as a fixed list, once per document.
//
// The model brings one sentence per question, or nothing; code gives the
// verdict (auditMerge.judgeChecklist): a verbatim single sentence is "есть",
// anything else "нет". What a "нет" weighs is decided here — the severity below
// becomes the finding's severity and is the only one the score cap trusts for
// an absence, because a finding without a quote cannot be verified any other
// way. Edit the wording freely; the ids are stored in reports and must not be
// reused for a different question.
//
// What a decision means for depositors, borrowers and business is not asked
// here (decision of 03.11.2026): asked for one sentence, the model always
// brought a neighbouring one — an average deposit rate for "what it means for
// depositors" — and a verbatim sentence passed. The section audit asks it
// instead, one finding per audience per document (auditMerge.ts).
//
// Answers are kept in the report in full: they are the input for a later stage
// (what explanations each audience lacks).

export type ChecklistSeverity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface ChecklistItem {
  id: string;
  question: string;
  /** Severity of the finding when the answer is "no". */
  severity: ChecklistSeverity;
  /** The finding's title when the answer is "no" — shown as "В документе нет: …". */
  missing: string;
  /**
   * The evidence must stand at the start of the document — in its first
   * section or its first CHECKLIST_START_CHARS characters (decision of
   * 03.11.2026). A verbatim sentence alone proves the decision is stated, not
   * that it is stated first.
   */
  atStart?: boolean;
  /** Category of the resulting finding, one of the audit's categories. */
  category: 'readability' | 'terminology' | 'ambiguity' | 'context' | 'logic' | 'evidence' | 'data' | 'structure' | 'audience';
}

export const AUDIT_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: 'main-conclusion-first',
    question: 'Главный вывод или решение стоит в первом абзаце или в резюме?',
    atStart: true,
    severity: 'High',
    missing: 'главного вывода или решения в начале документа',
    category: 'structure',
  },
  {
    id: 'decision-reason',
    question: 'Названа причина решения (почему принято именно оно)?',
    severity: 'High',
    missing: 'причины решения',
    category: 'evidence',
  },
  {
    id: 'next-steps-conditions',
    question: 'Названы условия или сроки следующих решений (что заставит изменить ставку или меру, когда это вступит в силу)?',
    severity: 'High',
    missing: 'условий и сроков следующих решений',
    category: 'ambiguity',
  },
  {
    id: 'terms-explained',
    question: 'Термины и сокращения поясняются при первом упоминании?',
    severity: 'Medium',
    missing: 'пояснений терминов и сокращений при первом упоминании',
    category: 'terminology',
  },
  {
    id: 'numbers-units-base',
    question: 'У чисел есть единицы измерения и база сравнения (к чему, за какой период)?',
    severity: 'Medium',
    missing: 'единиц измерения или базы сравнения у части чисел',
    category: 'data',
  },
] as const;

export function checklistItem(id: string): ChecklistItem | undefined {
  return AUDIT_CHECKLIST.find((c) => c.id === id);
}
