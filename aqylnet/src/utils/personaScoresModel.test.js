import { describe, it, expect } from 'vitest';
import { buildPersonaScoresModel, fmtScore, scoreTone, NOT_SCORED, NO_DECISION_SHARE } from './personaScoresModel';
import { QUOTE_UNVERIFIED } from './reportTrust';

// A1 stage 1. The export carries the persona scores as computed by the server;
// this model only formats them. What it must not lose: the group, the failed
// persona, the unverified-quote mark.

const cell = (mean, byGroup = { population: null, business: null, experts: null }, extra = {}) =>
  ({ mean, sd: 0.5, n: 3, byGroup, gap: null, ...extra });
const criteria = [
  { key: 'clarity', n: 1, label: 'Понятность', computed: false },
  { key: 'terms', n: 6, label: 'Термины', computed: true },
];
const SCORES = {
  hasScores: true,
  criteria,
  sections: [{ id: 1, order: 0, title: '1. Решение', length: 100, terms: [], density: 0 }],
  personas: [
    { id: 1, name: 'Гульнар', group: 'population', status: 'scored', failReason: '', mainTakeaway: 'ставку сохранили', decision: 'не понял', myAction: 'ничего', document: { clarity: 6.25, terms: 7 }, sections: [] },
    { id: 2, name: 'Ерлан', group: 'experts', status: 'failed', failReason: 'ошибка обращения к модели', mainTakeaway: '', decision: '', myAction: '', document: { clarity: null, terms: null }, sections: [] },
  ],
  stats: {
    document: { clarity: cell(7, { population: 6, business: null, experts: 9 }, { gap: 3 }), terms: cell(8) },
    sections: [{ order: 0, cells: { clarity: cell(7), terms: cell(8) } }],
    top: [{ order: 0, key: 'clarity', gap: 3,
      high: { group: 'experts', mean: 9, quote: 'Комитет сохранил ставку.', quoteVerified: true },
      low: { group: 'population', mean: 6, quote: 'Этого нет в документе.', quoteVerified: false } }],
    shares: { scored: 1, decisionCount: 1, actionCount: 0, decision: 1, action: 0 },
    quotes: { total: 2, verified: 1 },
  },
};

describe('buildPersonaScoresModel', () => {
  it('no scores — nothing to export', () => {
    expect(buildPersonaScoresModel(null)).toBe(null);
    expect(buildPersonaScoresModel({ hasScores: false })).toBe(null);
  });

  it('the persona line carries the group and the formatted document scores', () => {
    const m = buildPersonaScoresModel(SCORES);
    expect(m.personas[0]).toBe('Гульнар (Население): 1. Понятность: 6,3; 6. Термины: 7');
  });

  it('a persona that failed is said to have failed, with the reason', () => {
    expect(buildPersonaScoresModel(SCORES).personas[1]).toBe(`Ерлан (Эксперты и посредники): ${NOT_SCORED} — ошибка обращения к модели`);
  });

  it('a divergence names both groups; the unverified quote is marked', () => {
    const top = buildPersonaScoresModel(SCORES).top[0];
    expect(top).toContain('1. Решение — Понятность: разница 3');
    expect(top).toContain('Эксперты и посредники 9: «Комитет сохранил ставку.»');
    expect(top).toContain(`Население 6: «Этого нет в документе.» (${QUOTE_UNVERIFIED})`);
  });

  it('group means and the "не понял" shares', () => {
    const m = buildPersonaScoresModel(SCORES);
    expect(m.groups[0]).toBe('Население: 1. Понятность: 6; 6. Термины: —');
    expect(m.shares).toBe('Не поняли, какое решение принято: 1 из 1 (100 %); не поняли, что делать: 0 из 1 (0 %).');
    // A document without a decision to check: the share says so, not «не поняли».
    expect(buildPersonaScoresModel(SCORES, { noDecision: true }).shares)
      .toBe(`Решение: ${NO_DECISION_SHARE} 1 из 1; не поняли, что делать: 0 из 1 (0 %).`);
  });
});

describe('fmtScore / scoreTone', () => {
  it('formats with a comma, null as a dash; tones on the report scale', () => {
    expect([fmtScore(7), fmtScore(6.25), fmtScore(null)]).toEqual(['7', '6,3', '—']);
    expect([scoreTone(8), scoreTone(5), scoreTone(4.9), scoreTone(null)]).toEqual(['good', 'mid', 'low', 'none']);
  });
});

describe('persona_score@3 in the export', () => {
  const v3 = {
    ...SCORES,
    criteria: [...criteria, { key: 'rateSignal', n: 4, label: 'Сигнал о будущей ставке', computed: false, documentLevel: true }],
    personas: [{ ...SCORES.personas[0], rateSignal: 3, documentLevels: { rateSignal: { level: 4, why: 'только «при необходимости»', adjusted: true } } }],
    stats: { ...SCORES.stats, unanswered: 7, sections: [{ order: 0, cells: { clarity: cell(7), terms: cell(8) }, unanswered: { total: 7, mean: 2.3 } }] },
  };

  it('section lines leave out the document-level criterion and carry the unanswered count', () => {
    const m = buildPersonaScoresModel(v3);
    expect(m.sections[0]).toBe('1. Решение: 1. Понятность: 7; 6. Термины: 8; вопросов без ответа: 7');
    expect(m.unanswered).toContain('всего: 7');
  });

  it('the rate signal travels with its phrase and the band mark', () => {
    expect(buildPersonaScoresModel(v3).readings[0]).toContain('сигнал о ставке 3 (только «при необходимости»), балл приведён к уровню');
  });
});

describe('the terms divergence is its own line', () => {
  it('present when the server sends one, empty otherwise', () => {
    const withTerms = { ...SCORES, stats: { ...SCORES.stats, topTerms: { order: 0, key: 'terms', gap: 6,
      high: { group: 'experts', mean: 9, quote: null, quoteVerified: null }, low: { group: 'population', mean: 3, quote: null, quoteVerified: null } } } };
    expect(buildPersonaScoresModel(withTerms).topTerms).toBe('Расхождение по терминам (считает система): 1. Решение — разница 6; Эксперты и посредники 9, Население 3');
    expect(buildPersonaScoresModel(SCORES).topTerms).toBe('');
  });
});
