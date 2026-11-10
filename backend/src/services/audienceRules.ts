// The code's side of the audience analysis (A1 stage 2): what goes into the
// model, what of its answer is kept, and every verdict. Pure functions, tested
// on their own.
//
//   - the reference: the decision sentence and three fields (actor, direction,
//     value), each with a quote the code checks — verbatim in the text, and
//     naming what the field says; an unchecked field is null;
//   - verdicts (decision_verdict@4): the model only extracts the same fields
//     from each answer; decideVerdict compares them. «не понял» is
//     not_understood with no call; no answer is null;
//   - missing explanations: each piece of a persona's material gets an id; an
//     item is kept only if it cites an existing id, at least one of them the
//     persona's own words (a question or «what I will do»), and — when three
//     or more personas of the group have material — two different personas. The
//     number of personas, the sections and the question shown are taken from
//     the material, never from the answer.

import { DECISION_VALUE_TOLERANCE, MISSING_TWO_PERSONAS_FROM } from '../config/limits';
import type {
  DecisionActor, DecisionAnswerInput, DecisionDirection, DecisionReferenceRaw, ExtractedDecision, MissingItemRaw,
  MissingSourceItem, ReferenceFieldRaw,
} from './llm.service';
import type { PersonaScoreDTO } from './personaScore.service';
import { NOT_UNDERSTOOD } from './personaScoreStats';
import { isSingleSentence, isVerbatimQuote } from './promptSafety';
import type { DecisionReference, MissingItem, PersonaVerdict, ReferenceField } from '../validators/audienceAnalysis.validator';

type Persona = Pick<PersonaScoreDTO, 'id' | 'status' | 'decision' | 'myAction' | 'sections'>;

export const ACTOR_LABELS: Record<DecisionActor, string> = {
  central_bank: 'Национальный Банк', government: 'Правительство', banks: 'банки', other: 'другой орган',
};
export const DIRECTION_LABELS: Record<DecisionDirection, string> = {
  raise: 'повышение', lower: 'снижение', hold: 'сохранение', other: 'иное решение',
};

// What a field's quote has to say for the field to stand. «other» needs no
// particular word.
const ACTOR_WORDS: Partial<Record<DecisionActor, RegExp>> = {
  central_bank: /национальн\p{L}*\s+банк|нацбанк|нбк|комитет|регулятор/iu,
  government: /правительств|министерств/iu,
  banks: /банк/iu,
};
export const DIRECTION_WORDS: Partial<Record<DecisionDirection, RegExp>> = {
  raise: /повы[сш]|увелич|ужесточ/iu,
  lower: /сни[жз]|пониж|уменьш|смягч/iu,
  hold: /сохран|оставл|остав[иа]|без\s+изменени|неизменн/iu,
};

export const sameValue = (a: number, b: number) => Math.abs(a - b) <= DECISION_VALUE_TOLERANCE + 1e-9;

function numbersIn(quote: string): number[] {
  return [...quote.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.'))).filter(Number.isFinite);
}

/** Does the quote name what the field says? */
function supports(kind: 'actor' | 'direction' | 'value', value: unknown, quote: string): boolean {
  if (kind === 'value') return numbersIn(quote).some((n) => sameValue(n, value as number));
  const words = kind === 'actor' ? ACTOR_WORDS[value as DecisionActor] : DIRECTION_WORDS[value as DecisionDirection];
  return !words || words.test(quote);
}

/** One field of the reference as stored: value null unless its quote checked out. */
export function checkReferenceField(
  kind: 'actor' | 'direction' | 'value',
  raw: ReferenceFieldRaw<DecisionActor | DecisionDirection | number> | null,
  quoteText: string,
): ReferenceField {
  if (!raw) return { value: null, proposed: null, quote: '', verified: null, reason: 'не названо в документе' };
  const base = { proposed: raw.value, quote: raw.quote };
  if (!isVerbatimQuote(raw.quote, quoteText)) return { ...base, value: null, verified: false, reason: 'цитата не найдена в документе дословно' };
  if (!supports(kind, raw.value, raw.quote)) return { ...base, value: null, verified: false, reason: 'цитата этого не называет' };
  return { ...base, value: raw.value, verified: true, reason: '' };
}

/**
 * The reference as stored. The decision sentence must be one sentence,
 * verbatim; without it there is no reference at all. Each field stands on its
 * own quote.
 */
export function checkReference(raw: DecisionReferenceRaw | null, quoteText: string): DecisionReference {
  const none = (reason: string): ReferenceField => ({ value: null, proposed: null, quote: '', verified: null, reason });
  if (!raw) return { quote: '', section: '', verified: null, reason: 'модель не назвала решение', actor: none(''), direction: none(''), value: none('') };
  const fields = {
    actor: checkReferenceField('actor', raw.actor, quoteText),
    direction: checkReferenceField('direction', raw.direction, quoteText),
    value: checkReferenceField('value', raw.value, quoteText),
  };
  const base = { quote: raw.quote, section: raw.section, ...fields };
  if (!isSingleSentence(raw.quote)) return { ...base, verified: false, reason: 'приведено больше одного предложения' };
  if (!isVerbatimQuote(raw.quote, quoteText)) return { ...base, verified: false, reason: 'цитата не найдена в документе дословно' };
  return { ...base, verified: true, reason: '' };
}

const fmtNum = (n: number) => String(n).replace('.', ',');

/**
 * The verdict, by code (decision of 04.11.2026). A reference field that is
 * null is not compared; neither is a field the answer does not name.
 *   - no decision named → not_understood;
 *   - wrong actor, wrong direction, or a value that differs → wrong;
 *   - direction right → correct (the value right or not named);
 *   - direction not named but a decision is → partial;
 *   - the reference has no checked direction: a matching value → correct,
 *     otherwise partial; no checked field at all → null, nothing to compare.
 */
export function decideVerdict(ref: Pick<DecisionReference, 'actor' | 'direction' | 'value'>, ex: ExtractedDecision): { verdict: PersonaVerdict['verdict']; reason: string } {
  if (!ex.named) return { verdict: 'not_understood', reason: 'ответ не называет решения' };
  const rActor = ref.actor.value as DecisionActor | null;
  const rDir = ref.direction.value as DecisionDirection | null;
  const rVal = ref.value.value as number | null;
  if (rActor === null && rDir === null && rVal === null) return { verdict: null, reason: 'в эталоне нет проверенных полей — сверить не с чем' };
  const errors: string[] = [];
  if (rActor && ex.actor && ex.actor !== rActor) errors.push(`назван не тот, кто принял решение: ${ACTOR_LABELS[ex.actor]} вместо «${ACTOR_LABELS[rActor]}»`);
  if (rDir && ex.direction && ex.direction !== rDir) errors.push(`направление: ${DIRECTION_LABELS[ex.direction]} вместо «${DIRECTION_LABELS[rDir]}»`);
  if (rVal !== null && ex.value !== null && !sameValue(ex.value, rVal)) errors.push(`величина ${fmtNum(ex.value)} вместо ${fmtNum(rVal)}`);
  if (errors.length > 0) return { verdict: 'wrong', reason: errors.join('; ') };
  if (rDir) return ex.direction ? { verdict: 'correct', reason: '' } : { verdict: 'partial', reason: 'направление решения не названо' };
  if (rVal !== null && ex.value !== null) return { verdict: 'correct', reason: '' };
  return { verdict: 'partial', reason: 'величина решения не названа' };
}

export interface VerdictPlan {
  /** Answers that go to the model, under ids that say nothing of the persona. */
  answers: DecisionAnswerInput[];
  personaOf: Map<string, number>;
  /** Verdicts code sets itself: «не понял», and null for no answer. */
  fixed: PersonaVerdict[];
}

export function planVerdicts(personas: Persona[]): VerdictPlan {
  const answers: DecisionAnswerInput[] = [];
  const personaOf = new Map<string, number>();
  const fixed: PersonaVerdict[] = [];
  for (const p of personas) {
    const decision = p.decision.trim();
    if (p.status !== 'scored' || !decision) {
      fixed.push({ personaId: p.id, verdict: null, reason: p.status !== 'scored' ? 'оценка участника не получена' : 'нет ответа о решении', by: 'code', extracted: null });
    } else if (NOT_UNDERSTOOD.test(decision)) {
      fixed.push({ personaId: p.id, verdict: 'not_understood', reason: 'ответил «не понял»', by: 'code', extracted: null });
    } else {
      const id = `R${answers.length + 1}`;
      answers.push({ id, text: decision });
      personaOf.set(id, p.id);
    }
  }
  return { answers, personaOf, fixed };
}

export const NO_COMPARABLE_DECISION = 'в документе нет решения с направлением или величиной — сверять ответы не с чем';

/**
 * Whether the reference is a decision an answer can be checked against
 * (decision of 10.11.2026): a verified sentence that says which way —
 * raise, lower, hold — or how much. An actor alone, or a direction «other»
 * without a value, is not one: on a news item or a strategy the model still
 * picks some sentence, every persona honestly answers «не понял», and a 0 %
 * share of «understood the decision» then drove every group to «непонятно»
 * over a decision the document does not contain. A measure with a number
 * (a debt-load cap of 40 %) stays comparable by its value.
 */
export function hasComparableDecision(ref: Pick<DecisionReference, 'verified' | 'direction' | 'value'>): boolean {
  if (ref.verified !== true) return false;
  const dir = ref.direction.value;
  return (dir !== null && dir !== 'other') || ref.value.value !== null;
}

/** Every persona with no reference to check against: null, with the reason. */
export function verdictsWithoutReference(personas: Persona[], reason = 'эталон не найден'): PersonaVerdict[] {
  return personas.map((p) => ({ personaId: p.id, verdict: null, reason, by: 'code' as const, extracted: null }));
}

/**
 * The plan, the extraction and the reference → one verdict per persona, in
 * the order of `personas`. `extracted` null = the call failed: its personas
 * are null. The verdict is always the code's; the extracted fields are kept
 * next to it for the report.
 */
export function applyVerdicts(
  personas: Persona[],
  plan: VerdictPlan,
  extracted: Map<string, ExtractedDecision> | null,
  ref: Pick<DecisionReference, 'actor' | 'direction' | 'value'>,
): PersonaVerdict[] {
  const fixed = new Map(plan.fixed.map((v) => [v.personaId, v]));
  const byPersona = new Map<number, PersonaVerdict>();
  for (const [id, personaId] of plan.personaOf) {
    const ex = extracted?.get(id);
    if (!ex) {
      byPersona.set(personaId, { personaId, verdict: null, reason: extracted === null ? 'извлечение не выполнено' : 'модель не разобрала ответ', by: 'code', extracted: null });
      continue;
    }
    byPersona.set(personaId, { personaId, ...decideVerdict(ref, ex), by: 'code', extracted: ex });
  }
  return personas.map((p) => byPersona.get(p.id) ?? fixed.get(p.id)!);
}

export interface SourceRecord extends MissingSourceItem { personaId: number }

const VERDICT_LABEL: Record<string, string> = {
  partial: 'понял частично', wrong: 'понял неверно', not_understood: 'не понял',
};

/** Criteria 2 and 3 at or below this level are material: «what to do» and «why» unanswered. */
const LOW_SCORE = 4;
const LOW_CRITERIA: { key: 'myAction' | 'reasons'; label: string }[] = [
  { key: 'myAction', label: 'Понятно, что делать мне' },
  { key: 'reasons', label: 'Объяснены причины' },
];

/**
 * A group's material, one id per piece: questions left unanswered by section,
 * what the persona will do, how it understood the decision (when not
 * correct), and sections where «what to do» or «why» scored 4 or lower.
 * Personas are labelled «участник N» — the model does not need their names.
 */
export function groupMaterial(
  personas: Persona[],
  verdicts: Map<number, PersonaVerdict>,
  sectionTitle: (order: number) => string,
): SourceRecord[] {
  const out: SourceRecord[] = [];
  const add = (r: Omit<SourceRecord, 'id'>) => out.push({ ...r, id: `M${out.length + 1}` });
  personas.filter((p) => p.status === 'scored').forEach((p, i) => {
    const persona = `участник ${i + 1}`;
    for (const s of p.sections) {
      if (s.skipped) continue;
      for (const u of s.unclear) add({ personaId: p.id, persona, kind: 'unclear', section: sectionTitle(s.order), text: u });
    }
    if (p.myAction.trim()) add({ personaId: p.id, persona, kind: 'action', section: null, text: p.myAction.trim() });
    const v = verdicts.get(p.id);
    if (v?.verdict && v.verdict !== 'correct') {
      add({
        personaId: p.id, persona, kind: 'verdict', section: null,
        text: `ответ «${p.decision.trim()}» — ${VERDICT_LABEL[v.verdict]}${v.reason ? `: ${v.reason}` : ''}`,
      });
    }
    for (const s of p.sections) {
      if (s.skipped) continue;
      for (const c of LOW_CRITERIA) {
        const score = s.scores[c.key];
        if (typeof score !== 'number' || score > LOW_SCORE) continue;
        const why = s.levels[c.key]?.why;
        add({ personaId: p.id, persona, kind: 'low_score', section: sectionTitle(s.order), text: `«${c.label}» — ${score} из 10${why ? `: ${why}` : ''}` });
      }
    }
  });
  return out;
}

export interface ResolvedMissing {
  items: MissingItem[];
  returned: number;
  dropped: number;
  droppedBy: { noSource: number; noWords: number; onePersona: number };
  unknownIds: number;
}

/** The persona's own words: a question it asked or what it says it will do. */
const OWN_WORDS = new Set(['unclear', 'action']);

/**
 * The model's items → what is kept (decision of 04.11.2026). Ids the
 * material did not carry are removed (and counted). An item is dropped when
 * none of its ids exist, when none of its sources is the persona's own words
 * (only a verdict or a low score), or when three or more personas of the
 * group have material and the item rests on one. Persona count, sections and the
 * question are taken from the material — sections fall back to the model's
 * names only when the sources carry none and the name is a real section.
 */
export function resolveMissing(raw: MissingItemRaw[], material: SourceRecord[], sectionTitles: string[]): ResolvedMissing {
  const byId = new Map(material.map((m) => [m.id, m]));
  const known = new Set(sectionTitles);
  const minPersonas = new Set(material.map((m) => m.personaId)).size >= MISSING_TWO_PERSONAS_FROM ? 2 : 1;
  const droppedBy = { noSource: 0, noWords: 0, onePersona: 0 };
  let unknownIds = 0;
  const items: MissingItem[] = [];
  for (const r of raw) {
    const ids = [...new Set(r.sourceIds)];
    const valid = ids.filter((id) => byId.has(id));
    unknownIds += ids.length - valid.length;
    if (valid.length === 0) { droppedBy.noSource++; continue; }
    const sources = valid.map((id) => byId.get(id)!);
    if (!sources.some((s) => OWN_WORDS.has(s.kind))) { droppedBy.noWords++; continue; }
    const personas = new Set(sources.map((s) => s.personaId)).size;
    if (personas < minPersonas) { droppedBy.onePersona++; continue; }
    const fromSources = [...new Set(sources.map((s) => s.section).filter((s): s is string => !!s))];
    items.push({
      missing: r.missing,
      suggestion: r.suggestion,
      sourceIds: valid,
      sections: fromSources.length > 0 ? fromSources : r.sections.filter((s) => known.has(s)),
      personas,
      question: sources.find((s) => s.kind === 'unclear')?.text ?? null,
    });
  }
  const dropped = droppedBy.noSource + droppedBy.noWords + droppedBy.onePersona;
  return { items, returned: raw.length, dropped, droppedBy, unknownIds };
}
