import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudiencePersona, audienceGap, decisionShare, groupTerms, groupUnderstanding, personaIndex, understandingLevel,
  understandingPhrase,
} from './audienceStats';

// A1 stage 2. Thresholds are the product ones from config/limits.ts:
// clear — index ≥ 7 and share ≥ 0.75; unclear — index < 5 or share < 0.5.

const p = (personaId: number, group: AudiencePersona['group'], c: number | null, m: number | null, t: number | null, verdict: AudiencePersona['verdict'] = null, extra: Partial<AudiencePersona> = {}): AudiencePersona => ({
  personaId, group, scored: true, document: { clarity: c, myAction: m, terms: t }, unanswered: 2, verdict,
  termsUnclear: [], extraWords: [], ...extra,
});

describe('index, share, level', () => {
  test('index is the mean of the non-null criteria 1, 3, 6', () => {
    assert.equal(personaIndex(p(1, 'population', 6, null, 9)), 7.5);
    assert.equal(personaIndex(p(1, 'population', null, null, null)), null);
  });

  test('share: correct + half of partial over the verdicts given; null without any', () => {
    assert.equal(decisionShare(['correct', 'partial', 'wrong', null]), 0.5);
    assert.equal(decisionShare([null, null]), null);
  });

  test('levels at the thresholds', () => {
    assert.equal(understandingLevel(7, 0.75), 'clear');
    assert.equal(understandingLevel(7, 0.74), 'partial');
    assert.equal(understandingLevel(6.9, 1), 'partial');
    assert.equal(understandingLevel(4.9, 1), 'unclear');
    assert.equal(understandingLevel(9, 0.49), 'unclear', 'a low share alone makes it unclear');
    assert.equal(understandingLevel(8, null), 'clear', 'without verdicts the index decides');
    assert.equal(understandingLevel(null, 1), null);
  });
});

describe('groups', () => {
  const ps = [
    p(1, 'population', 4, 3, 7, 'wrong'), p(2, 'population', 6, 4, 7, 'partial'),
    p(3, 'experts', 9, 7, 10, 'correct'), p(4, 'experts', 8, 7, 9, 'correct'),
    p(5, 'business', 7, 7, 8, 'partial'),
    { ...p(6, 'business', 1, 1, 1), scored: false },
  ];
  const groups = groupUnderstanding(ps);

  test('one entry per group with scored personas; an unscored persona counts nowhere', () => {
    assert.deepEqual(groups.map((g) => [g.group, g.personas, g.few]), [['population', 2, false], ['business', 1, true], ['experts', 2, false]]);
  });

  test('population: index 5.2, share 0.25 → unclear; experts: clear; business: partial', () => {
    const by = Object.fromEntries(groups.map((g) => [g.group, g]));
    assert.equal(by.population!.index, 5.2);
    assert.equal(by.population!.share, 0.25);
    assert.equal(by.population!.level, 'unclear');
    assert.deepEqual(by.population!.criteria, { clarity: 5, myAction: 3.5, terms: 7 });
    assert.equal(by.population!.unanswered, 4);
    assert.equal(by.experts!.level, 'clear');
    // index 7.3 ≥ 7, share 0.5: not below 0.5, not up to 0.75.
    assert.equal(by.business!.level, 'partial');
  });

  test('the phrase names the best and the worst group', () => {
    assert.equal(understandingPhrase(groups), 'Лучше всего текст поняли: эксперты и посредники. Хуже всего: население.');
    assert.equal(understandingPhrase(groups.slice(0, 1)), 'Текст оценила одна группа: население.');
    assert.equal(understandingPhrase([]), null);
  });

  test('written for the population, understood best by the experts: the shift comes first', () => {
    const gap = audienceGap(['population'], groups)!;
    assert.equal(gap.verdict, 'missed');
    assert.deepEqual(gap.shift, { intended: ['population'], best: ['experts'] });
    assert.equal(gap.phrases[0], 'Писали для населения, лучше всего поняли: эксперты и посредники.');
  });

  test('two targets, one clear: partly; no shift when a target is the best', () => {
    const gap = audienceGap(['experts', 'population'], groups)!;
    assert.equal(gap.verdict, 'partly');
    assert.equal(gap.shift, null);
    assert.equal(audienceGap(['experts'], groups)!.verdict, 'on_target');
  });

  test('a target group with no personas is said; with none present there is no verdict', () => {
    const only = groupUnderstanding([p(3, 'experts', 9, 7, 10, 'correct')]);
    const gap = audienceGap(['population', 'business'], only)!;
    assert.equal(gap.verdict, null);
    assert.equal(gap.shift!.best[0], 'experts');
    assert.match(gap.phrases[0]!, /^Писали для населения и бизнеса/);
    assert.equal(audienceGap([], only), null, 'no audience — no comparison');
  });
});

describe('terms per group', () => {
  test('counted by personas, most first, ties alphabetical; other groups ignored', () => {
    const ps = [
      p(1, 'population', 5, 5, 5, null, { termsUnclear: ['таргетирование', 'ДКП'], extraWords: ['коридор'] }),
      p(2, 'population', 5, 5, 5, null, { termsUnclear: ['ДКП'], extraWords: ['коридор'] }),
      p(3, 'experts', 5, 5, 5, null, { termsUnclear: ['таргетирование'] }),
    ];
    const t = groupTerms(ps, 'population', 10);
    assert.deepEqual(t.terms, [{ term: 'ДКП', personas: 2 }, { term: 'таргетирование', personas: 1 }]);
    assert.deepEqual(t.extra, [{ word: 'коридор', personas: 2 }]);
    assert.equal(groupTerms(ps, 'population', 1).terms.length, 1);
  });
});

describe('leader of the groups (decision of 04.11.2026)', () => {
  // test1 @4: business and experts both «частично», share 0,5, index 7,0 and 6,4.
  const g = (group: AudiencePersona['group'], c: number, verdicts: AudiencePersona['verdict'][]) =>
    verdicts.map((v, i) => p(i + (group === 'business' ? 10 : group === 'experts' ? 20 : 30), group, c, c, c, v));

  test('same level and share, indices less than 1 apart: both named', () => {
    const groups = groupUnderstanding([...g('population', 5, ['not_understood', 'wrong']), ...g('business', 7, ['correct', 'wrong']), ...g('experts', 6.4, ['correct', 'wrong'])]);
    assert.equal(understandingPhrase(groups), 'Лучше всего текст поняли: бизнес, эксперты и посредники. Хуже всего: население.');
  });

  test('a point or more apart: one leader', () => {
    const groups = groupUnderstanding([...g('population', 5, ['not_understood', 'wrong']), ...g('business', 7.4, ['correct', 'wrong']), ...g('experts', 6.4, ['correct', 'wrong'])]);
    assert.equal(understandingPhrase(groups), 'Лучше всего текст поняли: бизнес. Хуже всего: население.');
  });

  test('a near tie on index but another share: one leader', () => {
    const groups = groupUnderstanding([...g('population', 5, ['not_understood', 'wrong']), ...g('business', 7, ['correct', 'correct']), ...g('experts', 6.8, ['correct', 'wrong'])]);
    assert.match(understandingPhrase(groups)!, /^Лучше всего текст поняли: бизнес\./);
  });

  test('a target among the tied leaders: no shift', () => {
    const groups = groupUnderstanding([...g('population', 5, ['not_understood', 'wrong']), ...g('business', 7, ['correct', 'wrong']), ...g('experts', 6.4, ['correct', 'wrong'])]);
    assert.equal(audienceGap(['experts'], groups)!.shift, null);
  });
});
