// For whom the text is clear (A1 stage 2) — in code, never asked of the model.
//
// Pure functions over the persona scores of stage 1 and the decision
// verdicts:
//   - per group: the understanding index (a persona's mean of its document
//     scores on criteria 1, 3 and 6, averaged over the group), the share who
//     understood the decision (correct + half of partial over personas with a
//     verdict), the level from the product thresholds in config/limits.ts;
//   - the gap between the audience the document was written for and the
//     groups that understood it, with the shift — a non-target group that
//     understood best — said first;
//   - the dictionary terms each group marked unclear, by number of personas.
// The phrases are built from templates here. null is "not computed", never 0.

import {
  LEADER_INDEX_MARGIN, UNDERSTANDING_CLEAR_INDEX, UNDERSTANDING_CLEAR_SHARE, UNDERSTANDING_UNCLEAR_INDEX, UNDERSTANDING_UNCLEAR_SHARE,
} from '../config/limits';
import { GROUP_LABELS } from '../config/personaGroups';
import type { DecisionVerdict } from './llm.service';
import { GROUPS, Group, mean } from './personaScoreStats';

/** Criteria the understanding index is taken over: 1, 3, 6. */
export const INDEX_CRITERIA = ['clarity', 'myAction', 'terms'] as const;
export type IndexCriterion = typeof INDEX_CRITERIA[number];

export type UnderstandingLevel = 'clear' | 'partial' | 'unclear';

export interface AudiencePersona {
  personaId:    number;
  group:        Group | null;
  scored:       boolean;
  /** The persona's document scores (personaScoreStats.personaDocumentScore). */
  document:     Record<IndexCriterion, number | null>;
  /** Questions left unanswered, summed over its sections. */
  unanswered:   number;
  verdict:      DecisionVerdict | null;
  /** Dictionary terms it marked unclear in any section. */
  termsUnclear: string[];
  /** Unclear words outside the dictionary. */
  extraWords:   string[];
}

export interface GroupUnderstanding {
  group:      Group;
  personas:   number;
  /** Only one persona: the level is computed, and marked. */
  few:        boolean;
  index:      number | null;
  share:      number | null;
  /** Personas of the group with a verdict — the denominator of the share. */
  withVerdict: number;
  level:      UnderstandingLevel | null;
  criteria:   Record<IndexCriterion, number | null>;
  /** How many of the three criteria the index stands on (the card says so when < 3). */
  indexCriteria: number;
  unanswered: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** A persona's index: the mean of its non-null scores on criteria 1, 3, 6. */
export function personaIndex(p: AudiencePersona): number | null {
  return mean(INDEX_CRITERIA.map((k) => p.document[k]).filter((v): v is number => typeof v === 'number'));
}

/** correct + half of partial, over the verdicts given; null when there are none. */
export function decisionShare(verdicts: (DecisionVerdict | null)[]): number | null {
  const given = verdicts.filter((v): v is DecisionVerdict => v !== null);
  if (given.length === 0) return null;
  const score = given.reduce((a, v) => a + (v === 'correct' ? 1 : v === 'partial' ? 0.5 : 0), 0);
  return round2(score / given.length);
}

/**
 * The level from index and share. Without a share (no verdicts — no
 * reference, or the analysis was not run) the index decides alone.
 */
export function understandingLevel(index: number | null, share: number | null): UnderstandingLevel | null {
  if (index === null) return null;
  if (index < UNDERSTANDING_UNCLEAR_INDEX || (share !== null && share < UNDERSTANDING_UNCLEAR_SHARE)) return 'unclear';
  if (index >= UNDERSTANDING_CLEAR_INDEX && (share === null || share >= UNDERSTANDING_CLEAR_SHARE)) return 'clear';
  return 'partial';
}

/** Every group with at least one scored persona, in the order of GROUPS. */
export function groupUnderstanding(personas: AudiencePersona[]): GroupUnderstanding[] {
  const out: GroupUnderstanding[] = [];
  for (const g of GROUPS) {
    const ps = personas.filter((p) => p.scored && p.group === g);
    if (ps.length === 0) continue;
    const indices = ps.map(personaIndex).filter((v): v is number => v !== null);
    const idx = mean(indices);
    const index = idx === null ? null : round1(idx);
    const share = decisionShare(ps.map((p) => p.verdict));
    const criteria = Object.fromEntries(INDEX_CRITERIA.map((k) => {
      const m = mean(ps.map((p) => p.document[k]).filter((v): v is number => typeof v === 'number'));
      return [k, m === null ? null : round1(m)];
    })) as Record<IndexCriterion, number | null>;
    out.push({
      group: g,
      personas: ps.length,
      few: ps.length === 1,
      index,
      share,
      withVerdict: ps.filter((p) => p.verdict !== null).length,
      level: understandingLevel(index, share),
      criteria,
      indexCriteria: INDEX_CRITERIA.filter((k) => criteria[k] !== null).length,
      unanswered: ps.reduce((a, p) => a + p.unanswered, 0),
    });
  }
  return out;
}

const LEVEL_RANK: Record<UnderstandingLevel, number> = { clear: 2, partial: 1, unclear: 0 };
const rankKey = (g: GroupUnderstanding) => [g.level === null ? -1 : LEVEL_RANK[g.level], g.index ?? -1, g.share ?? -1];
const compare = (a: GroupUnderstanding, b: GroupUnderstanding) => {
  const ka = rankKey(a); const kb = rankKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
  return 0;
};

/** Groups best first: level, then index, then share. */
export function rankGroups(groups: GroupUnderstanding[]): GroupUnderstanding[] {
  return [...groups].sort(compare);
}

/** The groups tied for the best and for the worst place. */
export function extremes(groups: GroupUnderstanding[]): { best: Group[]; worst: Group[] } {
  const ranked = rankGroups(groups.filter((g) => g.level !== null));
  if (ranked.length === 0) return { best: [], worst: [] };
  const first = ranked[0]!; const last = ranked[ranked.length - 1]!;
  return {
    best: ranked.filter((g) => compare(g, first) === 0 || nearTie(g, first)).map((g) => g.group),
    worst: ranked.filter((g) => compare(g, last) === 0).map((g) => g.group),
  };
}

/**
 * The same level and the same share, indices less than one point apart: the
 * index alone does not make one group the leader (decision of 04.11.2026) —
 * the phrase names both.
 */
export function nearTie(a: GroupUnderstanding, b: GroupUnderstanding): boolean {
  if (a.level !== b.level || a.share !== b.share) return false;
  if (a.index === null || b.index === null) return a.index === b.index;
  return Math.abs(a.index - b.index) < LEADER_INDEX_MARGIN;
}

const nom = (gs: Group[]) => gs.map((g) => GROUP_LABELS[g].nom).join(', ');
const gen = (gs: Group[]) => {
  const names = gs.map((g) => GROUP_LABELS[g].gen);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
};

/** «Лучше всего текст поняли: …. Хуже всего: ….» — null when no group has a level. */
export function understandingPhrase(groups: GroupUnderstanding[]): string | null {
  const leveled = groups.filter((g) => g.level !== null);
  if (leveled.length === 0) return null;
  if (leveled.length === 1) return `Текст оценила одна группа: ${nom([leveled[0]!.group])}.`;
  const { best, worst } = extremes(leveled);
  if (best.length === leveled.length) return 'Все группы поняли текст одинаково.';
  return `Лучше всего текст поняли: ${nom(best)}. Хуже всего: ${nom(worst)}.`;
}

export type GapVerdict = 'on_target' | 'partly' | 'missed';

export interface AudienceGap {
  targets: { group: Group; present: boolean; level: UnderstandingLevel | null }[];
  /** null when no target group has personas in the project. */
  verdict: GapVerdict | null;
  /** A non-target group understood best. */
  shift:   { intended: Group[]; best: Group[] } | null;
  /** The phrases, the shift first — the main finding of the stage. */
  phrases: string[];
}

/** The gap between the audience the document was written for and its readers; null without an audience. */
export function audienceGap(intended: Group[], groups: GroupUnderstanding[]): AudienceGap | null {
  const wanted = GROUPS.filter((g) => intended.includes(g));
  if (wanted.length === 0) return null;
  const byGroup = new Map(groups.map((g) => [g.group, g]));
  const targets = wanted.map((g) => ({ group: g, present: byGroup.has(g), level: byGroup.get(g)?.level ?? null }));
  const present = targets.filter((t) => t.present);
  const phrases: string[] = [];

  const { best } = extremes(groups);
  const shift = best.length > 0 && best.every((g) => !wanted.includes(g)) ? { intended: wanted, best } : null;
  if (shift) phrases.push(`Писали для ${gen(wanted)}, лучше всего поняли: ${nom(best)}.`);

  const absent = targets.filter((t) => !t.present).map((t) => t.group);
  if (present.length === 0) {
    phrases.push(`В проекте нет участников целевых групп (${nom(wanted)}) — сравнение невозможно.`);
    return { targets, verdict: null, shift, phrases };
  }
  const clear = targets.filter((t) => t.level === 'clear').map((t) => t.group);
  const verdict: GapVerdict = clear.length === targets.length ? 'on_target' : clear.length > 0 ? 'partly' : 'missed';
  if (verdict === 'on_target') phrases.push('По адресу: все целевые группы поняли текст.');
  else if (verdict === 'partly') {
    const rest = targets.filter((t) => t.level !== 'clear').map((t) => t.group);
    phrases.push(`Частично по адресу: поняли — ${nom(clear)}; не на уровне «понятно» — ${nom(rest)}.`);
  } else phrases.push('Мимо адресата: ни одна целевая группа не поняла текст на уровне «понятно».');
  if (absent.length > 0) phrases.push(`В проекте нет участников целевой группы: ${nom(absent)}.`);
  return { targets, verdict, shift, phrases };
}

export interface GroupTerms {
  terms: { term: string; personas: number }[];
  extra: { word: string; personas: number }[];
}

const countBy = (lists: string[][], limit: number) => {
  const counts = new Map<string, number>();
  for (const l of lists) for (const w of new Set(l)) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Most personas first; equal counts in alphabetical order, so a rerun on the
  // same scores lists them the same way.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, limit);
};

/** The terms a group marked unclear, by number of its personas; top `limit` of each list. */
export function groupTerms(personas: AudiencePersona[], group: Group, limit: number): GroupTerms {
  const ps = personas.filter((p) => p.scored && p.group === group);
  return {
    terms: countBy(ps.map((p) => p.termsUnclear), limit).map(([term, n]) => ({ term, personas: n })),
    extra: countBy(ps.map((p) => p.extraWords), limit).map(([word, n]) => ({ word, personas: n })),
  };
}
