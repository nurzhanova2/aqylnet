// Persona scores (A1 stage 1) as text — the one place the block on the report
// page and the PDF/DOCX export take their wording and number formatting from.
// Every number here was computed on the server (personaScoreStats.ts); this
// module only formats it.

import { GROUP_LABELS, PERSONA_GROUPS, groupLabel } from './personaGroups';
import { QUOTE_UNVERIFIED } from './reportTrust';

export const NOT_SCORED = 'не оценила';

/** 7 → "7", 6.25 → "6,3", null → "—". */
export function fmtScore(v) {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

/** The tone of a 1–10 score: the same thresholds as the report's 0–100 scale. */
export function scoreTone(v) {
  if (v === null || v === undefined) return 'none';
  if (v >= 7.5) return 'good';
  if (v >= 5) return 'mid';
  return 'low';
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`);

function quoteText(q, verified) {
  if (!q) return '';
  return verified === false ? `«${q}» (${QUOTE_UNVERIFIED})` : `«${q}»`;
}

export function buildPersonaScoresModel(scores) {
  if (!scores?.hasScores) return null;
  const criteria = scores.criteria;
  const label = (key) => criteria.find((c) => c.key === key)?.label ?? key;
  const sectionTitle = (order) => scores.sections.find((s) => s.order === order)?.title ?? `Раздел ${order + 1}`;
  const line = (cells) => criteria.map((c) => `${c.n}. ${c.label}: ${fmtScore(cells[c.key])}`).join('; ');

  const doc = scores.stats.document;
  return {
    title: 'Оценки участников',
    note: 'Каждый участник оценил документ один, до обсуждения и независимо от других. Шкала 1–10; «—» — критерий неприменим к разделу. Критерий 6 считает система по терминам словаря.',
    criteria: criteria.map((c) => `${c.n}. ${c.label}${c.computed ? ' (считает система)' : ''}`),
    personas: scores.personas.map((p) => (p.status === 'scored'
      ? `${p.name} (${groupLabel(p.group)}): ${line(p.document)}`
      : `${p.name} (${groupLabel(p.group)}): ${NOT_SCORED}${p.failReason ? ` — ${p.failReason}` : ''}`)),
    // Criterion 4 is scored once per document: section lines leave it out.
    sections: scores.stats.sections.map((s) => `${sectionTitle(s.order)}: ${criteria.filter((c) => !c.documentLevel).map((c) => `${c.n}. ${c.label}: ${fmtScore(s.cells[c.key]?.mean)}`).join('; ')}; вопросов без ответа: ${s.unanswered?.total ?? '—'}`),
    documentLine: `Документ в целом: ${line(Object.fromEntries(Object.entries(doc).map(([k, c]) => [k, c.mean])))}`,
    spreadLine: `Разброс между участниками (стандартное отклонение): ${criteria.map((c) => `${c.n}. ${fmtScore(doc[c.key]?.sd)}`).join('; ')}`,
    groups: PERSONA_GROUPS.map((g) => `${GROUP_LABELS[g]}: ${line(Object.fromEntries(Object.entries(doc).map(([k, c]) => [k, c.byGroup[g]])))}`),
    gapLine: `Разница групп (максимум − минимум): ${criteria.map((c) => `${c.n}. ${fmtScore(doc[c.key]?.gap)}`).join('; ')}`,
    top: scores.stats.top.map((t) => [
      `${sectionTitle(t.order)} — ${label(t.key)}: разница ${fmtScore(t.gap)}`,
      `${GROUP_LABELS[t.high.group]} ${fmtScore(t.high.mean)}${t.high.quote ? `: ${quoteText(t.high.quote, t.high.quoteVerified)}` : ''}`,
      `${GROUP_LABELS[t.low.group]} ${fmtScore(t.low.mean)}${t.low.quote ? `: ${quoteText(t.low.quote, t.low.quoteVerified)}` : ''}`,
    ].join(' | ')),
    // Criterion 6 is ranked apart from 1–5: computed by code, wider range.
    topTerms: scores.stats.topTerms
      ? `Расхождение по терминам (считает система): ${sectionTitle(scores.stats.topTerms.order)} — разница ${fmtScore(scores.stats.topTerms.gap)}; ${GROUP_LABELS[scores.stats.topTerms.high.group]} ${fmtScore(scores.stats.topTerms.high.mean)}, ${GROUP_LABELS[scores.stats.topTerms.low.group]} ${fmtScore(scores.stats.topTerms.low.mean)}`
      : '',
    shares: `Не поняли, какое решение принято: ${scores.stats.shares.decisionCount} из ${scores.stats.shares.scored} (${pct(scores.stats.shares.decision)}); не поняли, что делать: ${scores.stats.shares.actionCount} из ${scores.stats.shares.scored} (${pct(scores.stats.shares.action)}).`,
    readings: scores.personas.filter((p) => p.status === 'scored').map((p) => {
      const rs = p.documentLevels?.rateSignal;
      const signal = `сигнал о ставке ${fmtScore(p.rateSignal)}${rs?.why ? ` (${rs.why})` : ''}${rs?.adjusted ? ', балл приведён к уровню' : ''}`;
      return `${p.name}: главное — ${p.mainTakeaway || '—'}; решение — ${p.decision || '—'}; что сделаю — ${p.myAction || '—'}; ${signal}`;
    }),
    unanswered: `Вопросов без ответа (пункты «осталось непонятным»), всего: ${scores.stats.unanswered ?? '—'}`,
  };
}
