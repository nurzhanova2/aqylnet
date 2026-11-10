// «Кому понятен текст» (A1 stage 2) as one model for the report page and the
// PDF/DOCX export. Every number and every phrase was computed on the server
// (services/audienceStats.ts); this file only names things and orders them.

import { GROUP_LABELS, PERSONA_GROUPS } from './personaGroups';
import { fmtScore } from './personaScoresModel';

export const LEVEL_LABELS = { clear: 'понятно', partial: 'частично', unclear: 'непонятно' };
export const VERDICT_LABELS = { correct: 'верно', partial: 'частично', wrong: 'неверно', not_understood: 'не понял' };
/** null verdict: not checked — not «failed» (as the audit's null). */
export const NOT_CHECKED = 'не проверялось';
export const AUDIENCE_HINT = 'Укажите, для кого писался документ, чтобы увидеть разрыв.';
export const STALE_NOTE = 'Анализ устарел: оценки участников обновлены после него. Запустите анализ заново.';
export const REFERENCE_MISSING = 'Эталон решения не найден';

// Decision fields (decision_reference@2, decision_verdict@4): the backend's
// keys, product labels.
export const ACTOR_LABELS = { central_bank: 'Национальный Банк', government: 'Правительство', banks: 'банки', other: 'другой орган' };
export const DIRECTION_LABELS = { raise: 'повышение', lower: 'снижение', hold: 'сохранение', other: 'иное решение' };
export const NOT_STATED = 'не указано';

const fmtValue = (v) => (v === null || v === undefined ? NOT_STATED : String(v).replace('.', ','));

/** «кто: банки · направление: снижение · величина: 16,25» — what the persona's answer says. */
export function extractedLine(ex) {
  if (!ex) return '';
  if (!ex.named) return 'решение не названо';
  return [
    `кто: ${ex.actor ? ACTOR_LABELS[ex.actor] : NOT_STATED}`,
    `направление: ${ex.direction ? DIRECTION_LABELS[ex.direction] : NOT_STATED}`,
    `величина: ${fmtValue(ex.value)}`,
  ].join(' · ');
}

/** The reference's fields: the checked value, or why it is not compared. */
export function referenceFields(ref) {
  const one = (key, label, names) => {
    const f = ref?.[key];
    if (!f) return null;
    const value = f.value === null || f.value === undefined ? null : (key === 'value' ? fmtValue(f.value) : names[f.value]);
    return { key, label, value, quote: f.quote, verified: f.verified, note: value === null ? `не сравнивается${f.reason ? ` — ${f.reason}` : ''}` : '' };
  };
  return [
    one('actor', 'Кто принял', ACTOR_LABELS),
    one('direction', 'Направление', DIRECTION_LABELS),
    one('value', 'Величина', {}),
  ].filter(Boolean);
}

/** «индекс по 2 из 3 критериев» when the index stands on fewer than three. */
export function indexBasis(n) {
  return typeof n === 'number' && n < 3 ? `индекс по ${n} из 3 критериев` : null;
}

/**
 * Personas behind a missing explanation. One is marked as such: in a group of
 * one or two an item may rest on a single persona (decision of 04.11.2026).
 */
export function personasLabel(n) {
  return n === 1 ? '1 участник' : `участников: ${n}`;
}

/** Why items were dropped by code, for the page and the export. */
export function droppedLine(g) {
  const b = g.droppedBy ?? {};
  const parts = [
    b.noSource ? `без опоры на материалы — ${b.noSource}` : '',
    b.noWords ? `без слов участников (только вердикт или балл) — ${b.noWords}` : '',
    b.onePersona ? `на одном участнике — ${b.onePersona}` : '',
  ].filter(Boolean);
  return `Отброшено пунктов: ${g.dropped}${parts.length ? ` (${parts.join('; ')})` : ''}`;
}

/** clear → good, partial → mid, unclear → low, as the score tones. */
export function levelTone(level) {
  return level === 'clear' ? 'good' : level === 'partial' ? 'mid' : level === 'unclear' ? 'low' : 'none';
}

export function fmtShare(share) {
  return share === null || share === undefined ? '—' : `${Math.round(share * 100)} %`;
}

export function verdictLabel(v) {
  return v ? VERDICT_LABELS[v] : NOT_CHECKED;
}

export function buildAudienceModel(dto) {
  if (!dto) return null;
  const intended = dto.document?.intendedAudience ?? [];
  const a = dto.analysis;
  const groups = (dto.groups ?? []).map((g) => ({
    key: g.group,
    label: GROUP_LABELS[g.group],
    target: intended.includes(g.group),
    level: g.level,
    levelLabel: g.level ? LEVEL_LABELS[g.level] : NOT_CHECKED,
    tone: levelTone(g.level),
    index: fmtScore(g.index),
    indexValue: g.index,
    share: fmtShare(g.share),
    criteria: { clarity: fmtScore(g.criteria.clarity), myAction: fmtScore(g.criteria.myAction), terms: fmtScore(g.criteria.terms) },
    unanswered: g.unanswered,
    indexBasis: indexBasis(g.indexCriteria),
    personas: g.personas,
    few: g.few ? `мало участников (${g.personas})` : null,
  }));
  return {
    // The gap's phrases, the shift first; without an audience — the phrase
    // about the groups and the hint.
    headline: dto.gap ? dto.gap.phrases : [dto.phrase, AUDIENCE_HINT].filter(Boolean),
    phrase: dto.phrase,
    hasAudience: intended.length > 0,
    groups,
    analysis: a ? {
      stale: a.stale,
      reference: a.reference,
      referenceOk: a.reference.verified === true,
      referenceFields: referenceFields(a.reference),
      verdicts: a.verdicts.map((v) => ({
        ...v, groupLabel: GROUP_LABELS[v.group] ?? '', verdictLabel: verdictLabel(v.verdict), extractedLine: extractedLine(v.extracted),
      })),
      missing: PERSONA_GROUPS.filter((g) => a.missing[g]).map((g) => ({
        key: g,
        label: GROUP_LABELS[g],
        ...a.missing[g],
        terms: dto.terms?.[g] ?? { terms: [], extra: [] },
      })),
    } : null,
    terms: PERSONA_GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g], ...(dto.terms?.[g] ?? { terms: [], extra: [] }) })),
  };
}

/** «ДКП (4), дезинфляция (3)» — '' when none. */
export function termsLine(list, field = 'term') {
  return list.map((t) => `${t[field]} (${t.personas})`).join(', ');
}

/**
 * The block as lines for PDF/DOCX — the file is read by people who never saw
 * the page, so the not-checked marks and the stale note travel with it.
 */
export function audienceExportLines(dto) {
  const m = buildAudienceModel(dto);
  if (!m) return null;
  const a = m.analysis;
  const groups = m.groups.map((g) =>
    `${g.label}${g.target ? ' (целевая)' : ''}: ${g.levelLabel} — индекс ${g.index}${g.indexBasis ? ` (${g.indexBasis})` : ''}, верно поняли решение ${g.share}; понятность ${g.criteria.clarity}, что делать мне ${g.criteria.myAction}, термины ${g.criteria.terms}; вопросов без ответа ${g.unanswered}; участников ${g.personas}${g.few ? ` (${g.few})` : ''}`);
  const reference = !a ? '' : a.referenceOk
    ? `Решение по документу${a.reference.section ? ` (${a.reference.section})` : ''}: «${a.reference.quote}»`
      + (a.referenceFields.length ? `. Сверяется: ${a.referenceFields.map((f) => `${f.label.toLowerCase()} — ${f.value ?? f.note}`).join('; ')}` : '')
    : `${REFERENCE_MISSING}${a.reference.reason ? ` — ${a.reference.reason}` : ''}. Ответы участников не сверялись.`;
  const verdicts = !a ? [] : a.verdicts.map((v) =>
    `${v.name} (${v.groupLabel}): ${v.verdictLabel} — «${v.decision || '—'}»${v.extractedLine ? ` [${v.extractedLine}]` : ''}${v.verdict !== 'correct' && v.reason ? `. ${v.reason}` : ''}`);
  const missing = !a ? [] : a.missing.map((g) => ({
    label: g.label,
    lines: [
      ...(g.status !== 'ok' ? [g.reason] : []),
      ...(g.dropped > 0 ? [droppedLine(g)] : []),
      ...g.items.map((it, i) => [
        `${i + 1}. ${it.missing} (${personasLabel(it.personas)}${it.sections.length ? `; ${it.sections.join('; ')}` : ''})`,
        it.question ? `Вопрос участника: «${it.question}»` : '',
        it.suggestion ? `Что добавить: ${it.suggestion}` : '',
      ].filter(Boolean).join(' | ')),
      ...(g.terms.terms.length ? [`Непонятные термины: ${termsLine(g.terms.terms)}`] : []),
      ...(g.terms.extra.length ? [`Вне словаря: ${termsLine(g.terms.extra, 'word')}`] : []),
    ],
  }));
  return {
    title: 'Кому понятен текст',
    headline: [...m.headline, ...(m.hasAudience && m.phrase ? [m.phrase] : [])],
    stale: a?.stale ? STALE_NOTE : '',
    notRun: a ? '' : 'Проверка понимания решения не запускалась: доля верно понявших не посчитана, уровень — только по индексу.',
    groups,
    reference,
    verdicts,
    missing,
  };
}
