// The scale personas score a document by (A1 stage 1, persona scores).
//
// One place for the wording: the persona_score prompt is built from this file,
// and no other copy exists in the code. The level descriptions are the draft
// of the brief of 03.11.2026, carried over as written — edit them here.
//
// Scale 1–10. Levels 1, 4, 7 and 10 are described; a persona places itself
// between them. Criteria 3 and 4 may not apply to a section (a section on
// external conditions owes the reader no signal about the rate): then the
// persona answers null with a reason, and averages are taken over the
// sections where the criterion applies. Criterion 6 is not asked of the
// persona at all — the code computes it from the dictionary terms the persona
// marked as unclear (config/jargonDictionary.ts).

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

export type ScoreLevel = 1 | 4 | 7 | 10;
export const SCORE_LEVELS: readonly ScoreLevel[] = [1, 4, 7, 10];

/**
 * How far a score may stand from the level the persona chose (persona_score@3,
 * decision of 03.11.2026). The persona first picks the nearest described level
 * and says why, then scores within ±1 of it — anchoring the number to a
 * description instead of to "a safe 7". The code holds the bound.
 */
export const LEVEL_TOLERANCE = 1;

export interface ScoringCriterion {
  /** Stable key, stored with the scores — do not reuse for another question. */
  key: 'clarity' | 'reasons' | 'myAction' | 'rateSignal' | 'trust' | 'terms';
  /** Number as the brief and the report show it. */
  n: number;
  label: string;
  /** What each anchor level means, in the reader's own voice. */
  levels: Record<ScoreLevel, string>;
  /** May the persona answer null with a reason for a section? */
  mayBeInapplicable: boolean;
  /**
   * Scored once for the whole document, not per section (decision of
   * 03.11.2026): a signal about the future rate is a property of the
   * document; per section it was scored by sections that owe none.
   */
  documentLevel?: boolean;
  /** Computed by code, not asked of the persona. */
  computed: boolean;
}

export const SCORING_CRITERIA: readonly ScoringCriterion[] = [
  {
    key: 'clarity',
    n: 1,
    label: 'Понятность',
    levels: {
      1: 'не могу пересказать даже общий смысл',
      4: 'общий смысл ясен, но приходилось перечитывать',
      7: 'понятно с первого прочтения, есть отдельные тяжёлые места',
      10: 'понятно сразу, могу пересказать своими словами',
    },
    mayBeInapplicable: false,
    computed: false,
  },
  {
    key: 'reasons',
    n: 2,
    label: 'Объяснены причины',
    levels: {
      1: 'вывод или решение без причин',
      4: 'причины перечислены, но связь с решением не показана',
      7: 'цепочка «что происходит → почему это важно → какое решение» есть, с пробелами',
      10: 'полная цепочка, понятно, почему решение именно такое',
    },
    mayBeInapplicable: false,
    computed: false,
  },
  {
    key: 'myAction',
    n: 3,
    label: 'Понятно, что делать мне',
    levels: {
      1: 'не вижу, касается ли это меня',
      4: 'понимаю, что касается, но не знаю, что изменится',
      7: 'понимаю, что изменится для меня, но не что делать',
      10: 'могу назвать конкретное решение для себя',
    },
    mayBeInapplicable: true,
    computed: false,
  },
  {
    key: 'rateSignal',
    n: 4,
    label: 'Сигнал о будущей ставке',
    // persona_score@4 (03.11.2026): the levels follow the concept note's
    // definition — how unambiguous the path and the conditions for revisiting
    // it are. In @3 "direction named, conditions vague" was 7, so a signal
    // with no checkable condition at all scored 7 for nearly every persona.
    levels: {
      1: 'ничего о дальнейших шагах',
      4: 'направление названо, но условий нет или только общие слова («при необходимости»)',
      7: 'направление и хотя бы одно проверяемое условие: показатель, порог или срок',
      10: 'направление и конкретные условия, при которых оно изменится, в обе стороны',
    },
    mayBeInapplicable: false,
    documentLevel: true,
    computed: false,
  },
  {
    key: 'trust',
    n: 5,
    label: 'Доверие',
    levels: {
      1: 'уклончиво, проблемы замалчиваются или перекладываются',
      4: 'проблемы признаны формально',
      7: 'признаны честно, но без того, что это значит для людей',
      10: 'честно признаны, объяснено влияние на людей и что делается',
    },
    mayBeInapplicable: false,
    computed: false,
  },
  {
    key: 'terms',
    n: 6,
    label: 'Термины',
    // Not shown to the persona: the code computes this criterion. The levels
    // describe the formula's result for the report legend.
    levels: {
      1: 'непонятны все термины раздела',
      4: 'непонятны примерно две трети терминов',
      7: 'непонятна примерно треть терминов',
      10: 'все термины понятны или терминов нет',
    },
    mayBeInapplicable: false,
    computed: true,
  },
] as const;

/** The criteria the persona scores itself (1–5). */
export const PERSONA_CRITERIA = SCORING_CRITERIA.filter((c) => !c.computed);
/** Scored per section: 1, 2, 3, 5. */
export const SECTION_CRITERIA = PERSONA_CRITERIA.filter((c) => !c.documentLevel);
/** Scored once per document: 4. */
export const DOCUMENT_CRITERIA = PERSONA_CRITERIA.filter((c) => c.documentLevel);

/**
 * Criterion 6 from the dictionary terms found in a section and the ones the
 * persona marked unclear: 10 − round(9 × unclear / found); 10 when the section
 * has no dictionary terms. Unclear terms not among the found ones do not count.
 */
export function termsScore(found: number, unclear: number): number {
  if (found <= 0) return SCORE_MAX;
  const u = Math.max(0, Math.min(unclear, found));
  return SCORE_MAX - Math.round(9 * u / found);
}

/**
 * The scale as it goes into the persona_score prompt — the only rendering.
 * `section`: criteria scored per section; `document`: once per document.
 */
export function scaleForPrompt(scope: 'section' | 'document' = 'section'): string {
  const list = scope === 'section' ? SECTION_CRITERIA : DOCUMENT_CRITERIA;
  return list.map((c) => {
    const levels = SCORE_LEVELS.map((l) => `    ${l} — ${c.levels[l]}`).join('\n');
    const na = c.mayBeInapplicable ? '\n    Может быть неприменим к разделу: тогда level и score — null, а в why — причина.' : '';
    return `  ${c.n}. ${c.label} (${c.key}):\n${levels}${na}`;
  }).join('\n');
}

/**
 * A score held to ±LEVEL_TOLERANCE of the chosen level. Outside the band it is
 * moved to the nearest edge and marked `adjusted`; the edge is also kept
 * inside the scale.
 */
export function clampToLevel(level: ScoreLevel, score: number): { score: number; adjusted: boolean } {
  const lo = Math.max(SCORE_MIN, level - LEVEL_TOLERANCE);
  const hi = Math.min(SCORE_MAX, level + LEVEL_TOLERANCE);
  const c = Math.min(hi, Math.max(lo, score));
  return { score: c, adjusted: c !== score };
}
