import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVerdicts, checkReference, decideVerdict, groupMaterial, planVerdicts, resolveMissing, verdictsWithoutReference,
} from './audienceRules';
import type { ExtractedDecision } from './llm.service';
import type { PersonaVerdict } from '../validators/audienceAnalysis.validator';

// A1 stage 2: what goes to the model, what of its answer is kept, and the
// verdict — by code since decision_verdict@4.

type P = Parameters<typeof planVerdicts>[0][number];
const section = (order: number, unclear: string[], myAction: number | null = 7, reasons: number | null = 7, skipped = false) => ({
  sectionId: order + 1, order, skipped, unclear, termsFound: [], termsUnclear: [], quote: '', quoteHelped: null, quoteVerified: null, read: '',
  scores: { clarity: 7, reasons, myAction, rateSignal: null, trust: 7, terms: 10 },
  nullReasons: {}, levels: { myAction: { level: 4, why: 'не сказано, что делать', adjusted: false } },
});
const persona = (id: number, decision: string, extra: Partial<P> = {}): P => ({
  id, status: 'scored', decision, myAction: 'не понял, что делать', sections: [section(0, ['что с вкладами?'], 4), section(1, [], 7, 3)], ...extra,
});
const title = (o: number) => `${o + 1}. Раздел`;

const DOC = 'ПРЕСС-РЕЛИЗ О снижении базовой ставки до 16,25% по итогам прогнозного раунда. Комитет по денежно-кредитной политике Национального Банка Республики Казахстан принял решение установить базовую ставку на уровне 16,25% годовых.';
const raw = {
  quote: 'Комитет по денежно-кредитной политике Национального Банка Республики Казахстан принял решение установить базовую ставку на уровне 16,25% годовых.',
  section: '1. Раздел',
  actor: { value: 'central_bank' as const, quote: 'Комитет по денежно-кредитной политике Национального Банка' },
  direction: { value: 'lower' as const, quote: 'О снижении базовой ставки до 16,25%' },
  value: { value: 16.25, quote: 'установить базовую ставку на уровне 16,25% годовых' },
};
const ref = checkReference(raw, DOC);
const ex = (e: Partial<ExtractedDecision>): ExtractedDecision => ({ named: true, actor: null, direction: null, value: null, ...e });

describe('reference fields', () => {
  test('each field stands on its own quote; the title counts', () => {
    assert.equal(ref.verified, true);
    assert.deepEqual([ref.actor.value, ref.direction.value, ref.value.value], ['central_bank', 'lower', 16.25]);
  });

  test('a quote that does not name the value — «установить» for lower — or is not in the text: null', () => {
    const r = checkReference({ ...raw, direction: { value: 'lower', quote: 'установить базовую ставку на уровне 16,25%' }, value: { value: 16.5, quote: 'на уровне 16,25%' }, actor: { value: 'central_bank', quote: 'Совет директоров решил' } }, DOC);
    assert.deepEqual([r.direction.value, r.direction.verified, r.direction.reason], [null, false, 'цитата этого не называет']);
    assert.deepEqual([r.value.value, r.value.proposed], [null, 16.5]);
    assert.equal(r.actor.reason, 'цитата не найдена в документе дословно');
  });

  test('the decision sentence unverified: no reference', () => {
    assert.equal(checkReference({ ...raw, quote: 'Ставка снижена. Инфляция падает.' }, DOC).verified, false);
    assert.equal(checkReference(null, DOC).verified, null);
  });
});

describe('the verdict, by code', () => {
  test('«снизили до 16,25%» is correct; the actor unnamed is no error', () => {
    assert.deepEqual(decideVerdict(ref, ex({ direction: 'lower', value: 16.25 })), { verdict: 'correct', reason: '' });
    assert.equal(decideVerdict(ref, ex({ direction: 'lower' })).verdict, 'correct', 'the value not named');
  });

  test('«банки снизили» — wrong actor; another direction or value — wrong', () => {
    assert.equal(decideVerdict(ref, ex({ actor: 'banks', direction: 'lower', value: 16.25 })).verdict, 'wrong');
    assert.match(decideVerdict(ref, ex({ actor: 'banks', direction: 'lower' })).reason, /банки вместо «Национальный Банк»/);
    assert.equal(decideVerdict(ref, ex({ direction: 'hold', value: 16.25 })).verdict, 'wrong');
    assert.equal(decideVerdict(ref, ex({ direction: 'lower', value: 16.5 })).verdict, 'wrong');
    assert.equal(decideVerdict(ref, ex({ direction: 'lower', value: 16.255 })).verdict, 'correct', 'within 0,01');
  });

  test('direction not named but a decision is: partial; none named: not_understood', () => {
    assert.deepEqual(decideVerdict(ref, ex({ value: 16.25 })), { verdict: 'partial', reason: 'направление решения не названо' });
    assert.equal(decideVerdict(ref, ex({ named: false })).verdict, 'not_understood');
  });

  test('a null reference field is not compared', () => {
    const noDir = { ...ref, direction: { ...ref.direction, value: null } };
    assert.equal(decideVerdict(noDir, ex({ direction: 'raise', value: 16.25 })).verdict, 'correct', 'direction not compared, value matches');
    assert.equal(decideVerdict(noDir, ex({ direction: 'raise' })).verdict, 'partial');
    const none = { actor: { ...ref.actor, value: null }, direction: noDir.direction, value: { ...ref.value, value: null } };
    assert.equal(decideVerdict(none, ex({ direction: 'lower' })).verdict, null);
  });
});

describe('verdicts per persona', () => {
  const ps = [persona(1, 'Банки снизили ставку'), persona(2, 'не понял'), persona(3, ''), { ...persona(4, 'снизили'), status: 'failed' as const }, persona(5, 'Ставка снижена до 16,25%')];
  const plan = planVerdicts(ps);

  test('«не понял» is not_understood by code; no answer and a failed persona are null; the rest go to extraction under neutral ids', () => {
    assert.deepEqual(plan.answers, [{ id: 'R1', text: 'Банки снизили ставку' }, { id: 'R2', text: 'Ставка снижена до 16,25%' }]);
    assert.deepEqual(plan.fixed.map((v) => [v.personaId, v.verdict]), [[2, 'not_understood'], [3, null], [4, null]]);
  });

  test('the verdict is the code\'s and the extracted fields stay next to it; a persona not extracted is null', () => {
    const v = applyVerdicts(ps, plan, new Map([['R1', ex({ actor: 'banks', direction: 'lower' })]]), ref);
    assert.deepEqual(v.map((x) => [x.personaId, x.verdict, x.by]), [[1, 'wrong', 'code'], [2, 'not_understood', 'code'], [3, null, 'code'], [4, null, 'code'], [5, null, 'code']]);
    assert.deepEqual(v[0]!.extracted, ex({ actor: 'banks', direction: 'lower' }));
    assert.equal(v[4]!.reason, 'модель не разобрала ответ');
    assert.equal(applyVerdicts(ps, plan, null, ref)[0]!.reason, 'извлечение не выполнено');
  });

  test('no reference: everyone null, «эталон не найден»', () => {
    assert.deepEqual(verdictsWithoutReference(ps).map((v) => [v.verdict, v.reason]), ps.map(() => [null, 'эталон не найден']));
  });
});

describe('missing explanations', () => {
  const ps = [persona(1, 'Банки снизили ставку'), persona(2, 'снизили', { sections: [section(0, ['от чего зависит ставка?']), section(1, [], 7, 7, true)] })];
  const v = (personaId: number, verdict: PersonaVerdict['verdict'], reason = ''): PersonaVerdict => ({ personaId, verdict, reason, by: 'code', extracted: null });
  const material = groupMaterial(ps, new Map([[1, v(1, 'wrong', 'банки')], [2, v(2, 'correct')]]), title);

  test('material: questions, actions, a non-correct verdict, sections with «what to do»/«why» ≤ 4; skipped sections left out', () => {
    assert.deepEqual(material.map((m) => [m.id, m.kind, m.personaId, m.section]), [
      ['M1', 'unclear', 1, '1. Раздел'],
      ['M2', 'action', 1, null],
      ['M3', 'verdict', 1, null],
      ['M4', 'low_score', 1, '1. Раздел'],
      ['M5', 'low_score', 1, '2. Раздел'],
      ['M6', 'unclear', 2, '1. Раздел'],
      ['M7', 'action', 2, null],
    ]);
    assert.match(material[3]!.text, /^«Понятно, что делать мне» — 4 из 10: не сказано, что делать$/);
  });

  test('kept: existing ids, a persona\'s own words, two personas; personas, sections and the question from the material', () => {
    const r = resolveMissing([
      { missing: 'что решение значит для вкладов', sourceIds: ['M2', 'M1', 'M6', 'M99'], sections: ['выдуманный'], suggestion: 'добавить абзац' },
      { missing: 'пустой', sourceIds: ['X1'], sections: [], suggestion: '' },
      { missing: 'только вердикт и балл', sourceIds: ['M3', 'M4', 'M5'], sections: [], suggestion: '' },
      { missing: 'один участник', sourceIds: ['M1', 'M2'], sections: [], suggestion: '' },
      { missing: 'что делать', sourceIds: ['M2', 'M7'], sections: ['2. Раздел', 'выдуманный'], suggestion: '' },
    ], material, ['1. Раздел', '2. Раздел']);
    // Two personas with material: one persona is enough (decision of 04.11.2026).
    assert.deepEqual(r.droppedBy, { noSource: 1, noWords: 1, onePersona: 0 });
    assert.equal(r.dropped, 2);
    assert.equal(r.unknownIds, 2);
    assert.deepEqual(r.items[0], {
      missing: 'что решение значит для вкладов', suggestion: 'добавить абзац', sourceIds: ['M2', 'M1', 'M6'],
      sections: ['1. Раздел'], personas: 2, question: 'что с вкладами?',
    });
    assert.equal(r.items[1]!.personas, 1, 'kept on one persona, counted as one');
    assert.deepEqual(r.items[2]!.sections, ['2. Раздел'], 'no sections in the sources: the model\'s, if real');
  });

  test('a group where one persona has material: one persona is enough', () => {
    const one = groupMaterial([ps[0]!], new Map(), title);
    assert.equal(resolveMissing([{ missing: 'x', sourceIds: ['M1'], sections: [], suggestion: '' }], one, []).items.length, 1);
  });

  test('three personas with material: an item on one persona is dropped, on two kept', () => {
    const three = groupMaterial([...ps, persona(3, 'снизили')], new Map(), title);
    const third = three.find((m) => m.personaId === 3)!.id;
    const r = resolveMissing([
      { missing: 'один', sourceIds: ['M1'], sections: [], suggestion: '' },
      { missing: 'два', sourceIds: ['M1', third], sections: [], suggestion: '' },
    ], three, []);
    assert.deepEqual(r.items.map((i) => i.missing), ['два']);
    assert.equal(r.droppedBy.onePersona, 1);
  });
});
