import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findTerms, formToRegExp, isDictionaryTerm, termDensity, wordCount } from './jargon';
import { JARGON_DICTIONARY } from '../config/jargonDictionary';
import { termsScore, SCORING_CRITERIA, scaleForPrompt } from '../config/scoringScale';

// A1 stage 1. The lines are from test1 and the NBK reports.

describe('formToRegExp — word forms, hyphens and boundaries', () => {
  test('a stem matches every case form; the whole word does not match inside another', () => {
    const re = formToRegExp('нейтральн* ставк*');
    for (const s of ['нейтральной ставки', 'Нейтральная ставка', 'нейтральную ставку']) {
      re.lastIndex = 0;
      assert.equal(re.test(s.toLowerCase()), true, s);
    }
    const repo = formToRegExp('репо');
    assert.equal(repo.test('операции репо на бирже'), true);
    repo.lastIndex = 0;
    assert.equal(repo.test('репортаж'), false, 'not a prefix of another word');
  });

  test('a hyphen survives a PDF line break', () => {
    const re = formToRegExp('денежно-кредитн* услови*');
    assert.equal(re.test('денежно-\nкредитные условия'), true);
  });

  test('a stem does not match inside a longer word: "монетарн*" misses "немонетарных"', () => {
    assert.deepEqual(findTerms('влияние немонетарных факторов'), []);
    assert.deepEqual(findTerms('влияние монетарных факторов').map((t) => t.canonical), ['монетарные факторы']);
  });
});

describe('findTerms and density', () => {
  const jargon = 'Сохраняющийся дезинфляционный тренд пока не сопровождается достаточным ослаблением '
    + 'проинфляционных рисков, поскольку текущий уровень базовой ставки лишь умеренно превышает оценки '
    + 'нейтральной ставки, а трансмиссионный механизм функционирует с запаздыванием.';

  test('the planted jargon paragraph of test1 (D2) is found term by term', () => {
    const found = findTerms(jargon).map((t) => t.canonical);
    for (const t of ['дезинфляция', 'проинфляционный', 'нейтральная ставка', 'трансмиссионный механизм']) {
      assert.ok(found.includes(t), t);
    }
  });

  test('a term repeated is one unique term with a count; density is per 1 000 words', () => {
    const text = 'Нейтральная ставка выше. Оценки нейтральной ставки различаются.';
    assert.deepEqual(findTerms(text), [{ canonical: 'нейтральная ставка', count: 2 }]);
    assert.equal(wordCount(text), 7);
    assert.equal(termDensity(text), 142.9);
    assert.equal(termDensity(''), 0);
  });

  test('plain prose has no terms', () => {
    assert.deepEqual(findTerms('Для семьи это означает дополнительные расходы примерно 3 тысячи тенге в месяц.'), []);
  });

  test('isDictionaryTerm tells dictionary words from candidates', () => {
    assert.equal(isDictionaryTerm('нейтральная ставка'), true);
    assert.equal(isDictionaryTerm('NPL'), true);
    assert.equal(isDictionaryTerm('бивалютная корзина'), false);
  });

  test('the dictionary is 50–70 terms, every form compiles and no canonical repeats', () => {
    assert.ok(JARGON_DICTIONARY.length >= 50 && JARGON_DICTIONARY.length <= 70, String(JARGON_DICTIONARY.length));
    assert.equal(new Set(JARGON_DICTIONARY.map((t) => t.canonical)).size, JARGON_DICTIONARY.length);
    for (const t of JARGON_DICTIONARY) for (const f of t.forms) formToRegExp(f);
  });
});

describe('criterion 6 and the scale', () => {
  test('termsScore = 10 − round(9 × unclear / found); no terms is 10', () => {
    assert.equal(termsScore(0, 0), 10);
    assert.equal(termsScore(4, 0), 10);
    assert.equal(termsScore(4, 4), 1);
    assert.equal(termsScore(3, 1), 7);
    assert.equal(termsScore(3, 2), 4);
    assert.equal(termsScore(2, 5), 1, 'unclear cannot exceed found');
  });

  test('six criteria; 3 may be inapplicable to a section; 4 is scored per document; only 6 is computed', () => {
    assert.deepEqual(SCORING_CRITERIA.map((c) => c.n), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(SCORING_CRITERIA.filter((c) => c.mayBeInapplicable).map((c) => c.n), [3]);
    assert.deepEqual(SCORING_CRITERIA.filter((c) => c.documentLevel).map((c) => c.n), [4]);
    assert.deepEqual(SCORING_CRITERIA.filter((c) => c.computed).map((c) => c.n), [6]);
  });

  test('the prompt rendering: section criteria 1, 2, 3, 5; document criterion 4; never 6', () => {
    const sec = scaleForPrompt('section');
    const doc = scaleForPrompt('document');
    assert.match(sec, /могу назвать конкретное решение для себя/);
    assert.equal(sec.includes('Сигнал о будущей ставке'), false);
    assert.match(doc, /общие слова \(«при необходимости»\)/);
    assert.equal(sec.includes('Термины') || doc.includes('Термины'), false);
  });
});
