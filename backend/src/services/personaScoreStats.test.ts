import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentCell, notUnderstoodShares, personaDocumentScore, sd, sectionCell, sectionUnanswered, StatPersona, topDivergences,
} from './personaScoreStats';

// A1 stage 1. The tests are built so that different hypotheses give different
// numbers: one group high, another low, and a mean that matches neither.

const sections = [{ order: 0, length: 9_000 }, { order: 1, length: 1_000 }];

const persona = (personaId: number, group: StatPersona['group'], s0: number | null, s1: number | null, extra: Partial<StatPersona> = {}): StatPersona => ({
  personaId, group, scored: true, decision: 'сохранили ставку', myAction: 'ничего, меня не касается',
  sections: [
    { order: 0, scores: { clarity: s0 }, quote: `цитата ${personaId}-0`, quoteVerified: personaId % 2 === 0 },
    { order: 1, scores: { clarity: s1 }, quote: `цитата ${personaId}-1`, quoteVerified: true },
  ],
  ...extra,
});

describe('groups apart: the mean matches no group', () => {
  const ps = [persona(1, 'population', 2, 8), persona(2, 'population', 2, 8), persona(3, 'experts', 9, 8), persona(4, 'experts', 9, 8)];

  test('section cell: group means 2 and 9, mean 5.5, spread 3.5, gap 7', () => {
    const c = sectionCell(ps, 0, 'clarity');
    assert.deepEqual(c.byGroup, { population: 2, business: null, experts: 9 });
    assert.equal(c.mean, 5.5);
    assert.equal(c.sd, 3.5);
    assert.equal(c.gap, 7);
  });

  test('the top divergence is that cell, with a verified quote from each side when there is one', () => {
    const [top] = topDivergences(ps, sections);
    assert.equal(top.order, 0);
    assert.equal(top.gap, 7);
    assert.deepEqual([top.high.group, top.low.group], ['experts', 'population']);
    assert.equal(top.low.quote, 'цитата 2-0', 'the verified quote of the population is preferred');
    assert.equal(top.high.quote, 'цитата 4-0');
  });

  test('a section where the groups agree has gap 0 and ranks below', () => {
    const tops = topDivergences(ps, sections);
    assert.deepEqual(tops.map((t) => [t.order, t.gap]), [[0, 7], [1, 0]]);
  });
});

describe('document level: weighted by section length', () => {
  test('a persona\'s document score weighs the long section more', () => {
    // (2 × 9000 + 8 × 1000) / 10000 = 2.6, not the plain 5.
    assert.equal(personaDocumentScore(persona(1, 'population', 2, 8), sections, 'clarity'), 2.6);
  });

  test('document mean = weighted mean of section means; spread and groups over personas', () => {
    const ps = [persona(1, 'population', 2, 8), persona(3, 'experts', 10, 8)];
    const c = documentCell(ps, sections, 'clarity');
    // section means 6 and 8 → (6 × 9000 + 8 × 1000) / 10000 = 6.2
    assert.equal(c.mean, 6.2);
    // persona scores 2.6 and 9.8 → groups 2.6 / 9.8, gap 7.2, sd 3.6
    assert.deepEqual(c.byGroup, { population: 2.6, business: null, experts: 9.8 });
    assert.equal(c.gap, 7.2);
    assert.equal(c.sd, 3.6);
  });
});

describe('null means not applicable, never zero', () => {
  test('a null score is left out of the mean; a cell with no values is null', () => {
    const ps = [persona(1, 'population', null, 8), persona(2, 'business', 4, null)];
    assert.equal(sectionCell(ps, 0, 'clarity').mean, 4);
    assert.equal(sectionCell(ps, 0, 'clarity').n, 1);
    assert.equal(sectionCell(ps, 0, 'clarity').gap, null, 'one group only — no gap');
    assert.equal(sectionCell(ps, 0, 'rateSignal').mean, null);
  });

  test('a failed persona changes nothing', () => {
    const ok = [persona(1, 'population', 4, 4)];
    const failed: StatPersona = { ...persona(9, 'experts', 10, 10), scored: false };
    assert.deepEqual(sectionCell([...ok, failed], 0, 'clarity'), sectionCell(ok, 0, 'clarity'));
  });

  test('sd of one value is 0, of none null', () => {
    assert.equal(sd([5]), 0);
    assert.equal(sd([]), null);
  });
});

describe('"не понял" shares', () => {
  test('counted over scored personas only', () => {
    const ps = [
      persona(1, 'population', 5, 5, { decision: 'не понял', myAction: 'не понял, что делать' }),
      persona(2, 'population', 5, 5, { decision: 'Не понял, что решили' }),
      persona(3, 'experts', 5, 5),
      persona(4, 'experts', 5, 5, { scored: false, decision: 'не понял' }),
    ];
    assert.deepEqual(notUnderstoodShares(ps), { scored: 3, decisionCount: 2, actionCount: 1, decision: 0.67, action: 0.33 });
  });
});

describe('persona_score@3: a criterion scored once per document, and unanswered questions', () => {
  test('the document score of a document-level criterion is the persona\'s one value; the mean is over personas', () => {
    const ps: StatPersona[] = [
      { ...persona(1, 'population', 5, 5), documentScores: { rateSignal: 2 } },
      { ...persona(2, 'experts', 5, 5), documentScores: { rateSignal: 8 } },
    ];
    assert.equal(personaDocumentScore(ps[0]!, sections, 'rateSignal'), 2);
    const c = documentCell(ps, sections, 'rateSignal');
    assert.equal(c.mean, 5);
    assert.deepEqual(c.byGroup, { population: 2, business: null, experts: 8 });
    assert.equal(c.gap, 6);
    assert.equal(sectionCell(ps, 0, 'rateSignal').mean, null, 'no per-section value');
  });

  test('unanswered questions per section: total over scored personas and per persona; not a score', () => {
    const withUnclear = (id: number, n: number, scored = true): StatPersona => ({
      ...persona(id, 'population', 5, 5), scored,
      sections: [{ order: 0, scores: { clarity: 5 }, unclear: n }, { order: 1, scores: { clarity: 5 }, unclear: 0 }],
    });
    const ps = [withUnclear(1, 3), withUnclear(2, 1), withUnclear(3, 3, false)];
    assert.deepEqual(sectionUnanswered(ps, 0), { total: 4, mean: 2 });
    assert.equal(sectionCell(ps, 0, 'clarity').mean, 5, 'scores are not touched');
  });
});

describe('top divergences rank criteria 1–5; terms only on request', () => {
  test('a large gap on terms does not enter the top; asked for, it is found', () => {
    const p = (id: number, group: StatPersona['group'], clarity: number, terms: number): StatPersona => ({
      personaId: id, group, scored: true, decision: '', myAction: '',
      sections: [{ order: 0, scores: { clarity, terms } }, { order: 1, scores: { clarity, terms } }],
    });
    const ps = [p(1, 'population', 6, 1), p(2, 'experts', 8, 10)];
    assert.deepEqual(topDivergences(ps, sections).map((t) => t.key), ['clarity', 'clarity']);
    assert.equal(topDivergences(ps, sections, 1, ['terms'])[0]!.gap, 9);
  });
});
