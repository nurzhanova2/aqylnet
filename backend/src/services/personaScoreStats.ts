// Aggregates of persona scores (A1 stage 1) — in code, never asked of the model.
//
// Every number the report shows is computed here from the stored per-section
// scores, by pure functions:
//   - per section and criterion: mean over personas, spread (standard
//     deviation), mean per group and the gap between groups (max − min);
//   - per document: a persona's document score is the mean of its section
//     scores weighted by section length (as the audit weighs its axes); the
//     document mean is the length-weighted mean of the section means; spread
//     and group means are taken over the personas' document scores;
//   - the top divergences: section × criterion with the largest group gap —
//     the main finding of the stage, where a pensioner and an analyst read the
//     same section differently;
//   - the share of personas who answered "не понял" about the decision and
//     about what to do.
//
// null is "not applicable / not usable", never zero: it is left out of every
// mean, and a cell with no values is null, not 0. A persona that failed is
// passed in with no sections and changes nothing.

export const STAT_CRITERIA = ['clarity', 'reasons', 'myAction', 'rateSignal', 'trust', 'terms'] as const;
export type StatCriterion = typeof STAT_CRITERIA[number];
/**
 * The criteria the personas score themselves (1–5). The top divergences rank
 * only these (decision of 03.11.2026): criterion 6 is computed by code from a
 * share of terms and spans up to 9 points, so it took all five places; its
 * largest divergence is reported on its own line.
 */
export const PERSONA_STAT_CRITERIA: readonly StatCriterion[] = ['clarity', 'reasons', 'myAction', 'rateSignal', 'trust'];
export const GROUPS = ['population', 'business', 'experts'] as const;
export type Group = typeof GROUPS[number];

export interface StatSection { order: number; length: number }

export interface StatPersona {
  personaId: number;
  group:     Group | null;
  scored:    boolean;
  decision:  string;
  myAction:  string;
  sections:  { order: number; scores: Partial<Record<StatCriterion, number | null>>; quote?: string; quoteVerified?: boolean | null; quoteHelped?: boolean | null; unclear?: number }[];
  /**
   * Criteria scored once per document, not per section (persona_score@3:
   * the rate signal). For these the persona's document score is this value,
   * and the document mean is the mean over personas.
   */
  documentScores?: Partial<Record<StatCriterion, number | null>>;
}

export interface CellStats {
  mean:    number | null;
  sd:      number | null;
  n:       number;
  byGroup: Record<Group, number | null>;
  /** max − min of the group means; null when fewer than two groups have values. */
  gap:     number | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation; 0 for a single value, null for none. */
export function sd(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export function weightedMean(pairs: { value: number; weight: number }[]): number | null {
  const w = pairs.reduce((a, p) => a + p.weight, 0);
  return w <= 0 ? null : pairs.reduce((a, p) => a + p.value * p.weight, 0) / w;
}

function cell(values: { group: Group | null; value: number }[]): CellStats {
  const xs = values.map((v) => v.value);
  const byGroup = {} as Record<Group, number | null>;
  for (const g of GROUPS) {
    const m = mean(values.filter((v) => v.group === g).map((v) => v.value));
    byGroup[g] = m === null ? null : round1(m);
  }
  const present = GROUPS.map((g) => byGroup[g]).filter((v): v is number => v !== null);
  const m = mean(xs);
  const s = sd(xs);
  return {
    mean: m === null ? null : round1(m),
    sd: s === null ? null : round1(s),
    n: xs.length,
    byGroup,
    gap: present.length >= 2 ? round1(Math.max(...present) - Math.min(...present)) : null,
  };
}

const scoredOnly = (personas: StatPersona[]) => personas.filter((p) => p.scored);

/** One section, one criterion, across personas. */
export function sectionCell(personas: StatPersona[], order: number, key: StatCriterion): CellStats {
  const values: { group: Group | null; value: number }[] = [];
  for (const p of scoredOnly(personas)) {
    const v = p.sections.find((s) => s.order === order)?.scores[key];
    if (typeof v === 'number') values.push({ group: p.group, value: v });
  }
  return cell(values);
}

/** A persona's document score: its section scores weighted by section length. */
export function personaDocumentScore(p: StatPersona, sections: StatSection[], key: StatCriterion): number | null {
  if (p.documentScores && key in p.documentScores) {
    const v = p.documentScores[key];
    return typeof v === 'number' ? v : null;
  }
  const pairs = p.sections.flatMap((s) => {
    const v = s.scores[key];
    const length = sections.find((x) => x.order === s.order)?.length ?? 0;
    return typeof v === 'number' ? [{ value: v, weight: Math.max(1, length) }] : [];
  });
  const m = weightedMean(pairs);
  return m === null ? null : round1(m);
}

/**
 * The document, one criterion. The mean is the length-weighted mean of the
 * section means; spread and group means are over the personas' document
 * scores, so "how far apart are the readers" is about readers, not sections.
 */
export function documentCell(personas: StatPersona[], sections: StatSection[], key: StatCriterion): CellStats {
  const sectionMeans = sections.flatMap((s) => {
    const c = sectionCell(personas, s.order, key);
    return c.mean === null ? [] : [{ value: c.mean, weight: Math.max(1, s.length) }];
  });
  const perPersona = scoredOnly(personas).flatMap((p) => {
    const v = personaDocumentScore(p, sections, key);
    return v === null ? [] : [{ group: p.group, value: v }];
  });
  const c = cell(perPersona);
  // A criterion scored once per document has no section means: its document
  // mean is the mean over personas, which cell() already is.
  const documentLevel = scoredOnly(personas).some((p) => p.documentScores && key in p.documentScores);
  if (documentLevel) return c;
  const m = weightedMean(sectionMeans);
  return { ...c, mean: m === null ? null : round1(m) };
}

/**
 * Questions a section left the readers with — the count of "unclear" points,
 * summed over scored personas, and per persona. Shown next to the scores and
 * never mixed into them (decision of 03.11.2026): in @2 the personas named the
 * missing rate triggers in words while scoring the signal 6–8.
 */
export function sectionUnanswered(personas: StatPersona[], order: number): { total: number; mean: number | null } {
  const counts = scoredOnly(personas).flatMap((p) => {
    const s = p.sections.find((x) => x.order === order);
    return s && typeof s.unclear === 'number' ? [s.unclear] : [];
  });
  const m = mean(counts);
  return { total: counts.reduce((a, b) => a + b, 0), mean: m === null ? null : round1(m) };
}

export interface Divergence {
  order:   number;
  key:     StatCriterion;
  gap:     number;
  high:    { group: Group; mean: number; quote: string | null; quoteVerified: boolean | null };
  low:     { group: Group; mean: number; quote: string | null; quoteVerified: boolean | null };
}

/**
 * Section × criterion with the largest gap between groups, largest first.
 * Each carries a quote from a persona of the highest and of the lowest group
 * in that section — a verified one when there is one.
 */
export function topDivergences(
  personas: StatPersona[],
  sections: StatSection[],
  limit = 5,
  keys: readonly StatCriterion[] = PERSONA_STAT_CRITERIA,
): Divergence[] {
  const quoteOf = (order: number, group: Group) => {
    const qs = scoredOnly(personas).filter((p) => p.group === group)
      .map((p) => p.sections.find((s) => s.order === order))
      .filter((s): s is NonNullable<typeof s> => !!s?.quote);
    const pick = qs.find((s) => s.quoteVerified === true) ?? qs[0];
    return { quote: pick?.quote ?? null, quoteVerified: pick?.quoteVerified ?? null };
  };
  const all: Divergence[] = [];
  for (const s of sections) {
    for (const key of keys) {
      const c = sectionCell(personas, s.order, key);
      // Groups that agree are not a divergence: with gap 0 «high» and «low»
      // were the same group, and the report read «население 10, население 10».
      if (c.gap === null || c.gap === 0) continue;
      const present = GROUPS.filter((g) => c.byGroup[g] !== null);
      const high = present.reduce((a, b) => (c.byGroup[b]! > c.byGroup[a]! ? b : a));
      const low = present.reduce((a, b) => (c.byGroup[b]! < c.byGroup[a]! ? b : a));
      all.push({
        order: s.order, key, gap: c.gap,
        high: { group: high, mean: c.byGroup[high]!, ...quoteOf(s.order, high) },
        low: { group: low, mean: c.byGroup[low]!, ...quoteOf(s.order, low) },
      });
    }
  }
  // Stable: equal gaps keep document order, then criterion order.
  return all.sort((a, b) => b.gap - a.gap).slice(0, limit);
}

export const NOT_UNDERSTOOD = /не\s+понял/i;

/** Shares of scored personas who did not understand the decision / what to do. */
export interface Shares {
  scored: number;
  decisionCount: number;
  actionCount: number;
  /** Shares to two decimals — a tenth would show 1 of 8 as 10 %. */
  decision: number | null;
  action: number | null;
}

export function notUnderstoodShares(personas: StatPersona[]): Shares {
  const s = scoredOnly(personas);
  const decisionCount = s.filter((p) => NOT_UNDERSTOOD.test(p.decision)).length;
  const actionCount = s.filter((p) => NOT_UNDERSTOOD.test(p.myAction)).length;
  const share = (n: number) => (s.length === 0 ? null : Math.round((n / s.length) * 100) / 100);
  return { scored: s.length, decisionCount, actionCount, decision: share(decisionCount), action: share(actionCount) };
}
