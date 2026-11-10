import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLeveled, normalizePersonaScore, promptHash } from './llm.service';
import { splitUnclear } from './jargon';
import { clampToLevel } from '../config/scoringScale';

// A1 stage 1, persona_score@3: level → phrase → score within ±1. The answer is
// normalised before Zod: a score off its level is moved to the band and
// marked, one bad field never costs the persona the rest, a skipped section is
// null, not an error.

describe('clampToLevel — the ±1 band, inside the scale', () => {
  test('inside the band stays; outside moves to the nearest edge and is marked', () => {
    assert.deepEqual(clampToLevel(7, 8), { score: 8, adjusted: false });
    assert.deepEqual(clampToLevel(7, 6), { score: 6, adjusted: false });
    assert.deepEqual(clampToLevel(4, 7), { score: 5, adjusted: true });
    assert.deepEqual(clampToLevel(7, 3), { score: 6, adjusted: true });
  });

  test('the band of 1 and 10 does not leave the scale', () => {
    assert.deepEqual(clampToLevel(1, 3), { score: 2, adjusted: true });
    assert.deepEqual(clampToLevel(10, 8), { score: 9, adjusted: true });
  });
});

describe('normalizeLeveled', () => {
  test('a level, a phrase and a score in the band pass as they are', () => {
    assert.deepEqual(normalizeLeveled('clarity', { level: 4, why: 'перечитывала дважды', score: 5 }),
      { value: 5, level: 4, why: 'перечитывала дважды', adjusted: false });
  });

  test('a score off its level is moved into the band and marked', () => {
    assert.deepEqual(normalizeLeveled('trust', { level: 4, why: 'формально', score: 8 }),
      { value: 5, level: 4, why: 'формально', adjusted: true });
  });

  test('a level that is not 1/4/7/10: the score stands, the nearest anchor is reconstructed and marked', () => {
    assert.deepEqual(normalizeLeveled('clarity', { level: 6, why: 'x', score: 8 }),
      { value: 8, level: 7, why: 'x', adjusted: true });
  });

  test('a score outside 1–10 is «некорректно», never clamped into the scale', () => {
    for (const score of [0, 11, 'восемь']) {
      assert.deepEqual(normalizeLeveled('clarity', { level: 7, why: '', score }),
        { value: null, level: null, why: '', adjusted: false, reason: 'некорректно' }, String(score));
    }
  });

  test('level and score null: the phrase is the reason; without one — «неприменимо» for 3, «не указано» otherwise', () => {
    assert.deepEqual(normalizeLeveled('myAction', { level: null, why: 'раздел не про меня', score: null }),
      { value: null, level: null, why: 'раздел не про меня', adjusted: false, reason: 'раздел не про меня' });
    assert.equal(normalizeLeveled('myAction', {}).reason, 'неприменимо');
    assert.equal(normalizeLeveled('trust', {}).reason, 'не указано');
  });
});

describe('normalizePersonaScore', () => {
  const lv = (level: number, score: number) => ({ level, why: `уровень ${level}`, score });
  const parsed = {
    sections: [
      { n: 2, read: 'про цены', unclear: ['a', 'b', 'c', 'd'], unclearTerms: ['НПЛ'], quote: 'Цитата.', quoteEffect: 'помешало',
        scores: { clarity: lv(4, 4), reasons: { level: 7, score: 15 }, myAction: { level: null, why: 'не про меня', score: null }, trust: lv(7, 6),
          rateSignal: lv(1, 1) } },
      { n: 1, read: 'про ставку', quoteEffect: 'Помогло', scores: { clarity: lv(10, 9), reasons: lv(7, 8), myAction: lv(7, 7), trust: lv(7, 8) } },
    ],
    mainTakeaway: 'ставку сохранили', decision: 'не понял', myAction: 'ничего, меня не касается',
    rateSignal: { level: 4, why: 'только «при необходимости»', score: 3 },
  };
  const r = normalizePersonaScore(parsed, 3);

  test('answers are placed by their number, in document order', () => {
    assert.deepEqual(r.sections.map((s) => [s.n, s.read]), [[1, 'про ставку'], [2, 'про цены'], [3, '']]);
  });

  test('sections carry criteria 1, 2, 3, 5 only — a rate signal given per section is ignored', () => {
    assert.deepEqual(Object.keys(r.sections[1]!.scores).sort(), ['clarity', 'myAction', 'reasons', 'trust']);
  });

  test('one bad score does not cost the others', () => {
    const s = r.sections[1]!.scores;
    assert.deepEqual([s.clarity!.value, s.reasons!.value, s.myAction!.value, s.trust!.value], [4, null, null, 6]);
    assert.equal(s.reasons!.reason, 'некорректно');
    assert.equal(s.myAction!.reason, 'не про меня');
  });

  test('the rate signal is read once, from the document block', () => {
    assert.deepEqual(r.document.rateSignal, { value: 3, level: 4, why: 'только «при необходимости»', adjusted: false });
  });

  test('a section the persona left out is skipped, every score null with a reason', () => {
    const s = r.sections[2]!;
    assert.equal(s.skipped, true);
    assert.ok(Object.values(s.scores).every((v) => v!.value === null && v!.reason === 'раздел пропущен'));
  });

  test('unclear is capped at 3; the quote effect is read loosely', () => {
    assert.equal(r.sections[1]!.unclear.length, 3);
    assert.equal(r.sections[0]!.quoteHelped, true);
    assert.equal(r.sections[1]!.quoteHelped, false);
  });

  test('no sections at all: every section skipped, no throw', () => {
    const empty = normalizePersonaScore({}, 2);
    assert.deepEqual(empty.sections.map((s) => s.skipped), [true, true]);
    assert.equal(empty.document.rateSignal!.value, null);
  });
});

describe('splitUnclear and promptHash', () => {
  test('dictionary terms of the section feed the score; other words are candidates; terms of other sections count for neither', () => {
    const out = splitUnclear(['нейтральной ставки', 'КДН', 'бивалютная корзина', 'трансмиссионный механизм'], ['нейтральная ставка', 'трансмиссионный механизм']);
    assert.deepEqual(out.terms.sort(), ['нейтральная ставка', 'трансмиссионный механизм']);
    assert.deepEqual(out.others, ['бивалютная корзина']);
  });

  test('the prompt hash does not depend on the per-request fence tag', () => {
    assert.equal(promptHash(['система aaaa1111', 'документ aaaa1111'], 'aaaa1111'), promptHash(['система bbbb2222', 'документ bbbb2222'], 'bbbb2222'));
    assert.notEqual(promptHash(['система TAG', 'документ 1'], 'x'), promptHash(['система TAG', 'документ 2'], 'x'));
  });
});
