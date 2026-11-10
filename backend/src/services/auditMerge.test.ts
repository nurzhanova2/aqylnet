import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checklistIssues, collapseAudiences, contradictionCandidates, contradictionIssues, judgeChecklist, mergeAudit, mergeIssues,
  mergeScores, mergeSections, MergeSection, opposite, samePhenomenon, startsEarly,
} from './auditMerge';
import { AUDIT_CHECKLIST } from '../config/auditChecklist';
import type { AuditIssue, AuditScore, ClaimDirection } from './llm.service';

// A1 stage 0: the document audit is merged from section audits in code.

const axes = (clarity: number, evidence: number, relevance = 80, trust = 80): AuditScore[] => [
  { key: 'clarity',   label: 'Ясность',         value: clarity,   note: `ясность ${clarity}` },
  { key: 'evidence',  label: 'Доказательность', value: evidence,  note: `доказ ${evidence}` },
  { key: 'relevance', label: 'Релевантность',   value: relevance, note: '' },
  { key: 'trust',     label: 'Доверие',         value: trust,     note: '' },
];

const issue = (quote: string, severity: string, section = 'Раздел'): Omit<AuditIssue, 'code'> => ({
  title: `замечание к «${quote}»`, category: 'ambiguity', severity, quote,
  raisedBy: '', agreedBy: '', disputedBy: '', section,
});

const ok = (order: number, length: number, scores: AuditScore[], issues: Omit<AuditIssue, 'code'>[] = [], note = ''): MergeSection =>
  ({ order, heading: `${order + 1}. Раздел`, length, result: { ok: true, scores, issues, note, claims: [] } });

const failed = (order: number, length: number): MergeSection =>
  ({ order, heading: `${order + 1}. Раздел`, length, result: { ok: false, reason: 'ошибка обращения к модели' } });

describe('mergeScores — length-weighted mean of the section axes', () => {
  test('a long section weighs more than a short one', () => {
    // Unweighted mean would be 60; weighted by 9000:1000 it is 76.
    const s = mergeScores([ok(0, 9_000, axes(80, 80)), ok(1, 1_000, axes(40, 40))]);
    assert.equal(s.find((x) => x.key === 'clarity')?.value, 76);
  });

  test('a failed section is left out, not counted as zero', () => {
    const s = mergeScores([ok(0, 5_000, axes(70, 70)), failed(1, 5_000)]);
    assert.equal(s.find((x) => x.key === 'clarity')?.value, 70);
  });

  test('each axis keeps the note of the section that scored lowest on it', () => {
    const s = mergeScores([ok(0, 5_000, axes(90, 30)), ok(1, 5_000, axes(50, 70))]);
    assert.equal(s.find((x) => x.key === 'clarity')?.note, 'ясность 50');
    assert.equal(s.find((x) => x.key === 'evidence')?.note, 'доказ 30');
  });

  test('no analysed section, no axes — and so no overall score', () => {
    const merged = mergeAudit([failed(0, 5_000), failed(1, 3_000)], []);
    assert.deepEqual(merged.scores, []);
    assert.equal(merged.overallScore, null);
  });
});

describe('mergeIssues — union, deduplicated by normalised quote', () => {
  test('the same quote from two sections is one finding, the more severe copy kept', () => {
    const out = mergeIssues([
      ok(0, 5_000, axes(70, 70), [issue('Рост составил 2,3', 'Medium')]),
      ok(1, 5_000, axes(70, 70), [issue('рост  составил 2,3.', 'High')]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'High');
  });

  test('findings without a quote are never merged with each other', () => {
    const out = mergeIssues([ok(0, 5_000, axes(70, 70), [issue('', 'Low'), issue('', 'Low')])]);
    assert.equal(out.length, 2);
  });

  test('sorted by severity and renumbered from З-01', () => {
    const out = mergeIssues([ok(0, 5_000, axes(70, 70), [issue('а-цитата раз', 'Low'), issue('б-цитата два', 'Critical'), issue('в-цитата три', 'Medium')])]);
    assert.deepEqual(out.map((i) => i.severity), ['Critical', 'Medium', 'Low']);
    assert.deepEqual(out.map((i) => i.code), ['З-01', 'З-02', 'З-03']);
  });
});

describe('mergeSections — the map is the real sections', () => {
  test('in document order, with the failed one marked and without a score', () => {
    const map = mergeSections([ok(1, 4_000, axes(60, 60), [], 'второй'), failed(2, 4_000), ok(0, 4_000, axes(85, 85), [], 'первый')]);
    assert.deepEqual(map.map((m) => m.title), ['1. Раздел', '2. Раздел', '3. Раздел']);
    assert.deepEqual(map.map((m) => m.clarity), [85, 60, null]);
    assert.deepEqual(map.map((m) => m.analyzed), [true, true, false]);
    assert.match(map[2].note, /не проанализирован/);
  });

  test('a section without a heading is named by its position', () => {
    const map = mergeSections([{ order: 3, heading: null, length: 100, result: { ok: true, scores: axes(70, 70), issues: [], note: '', claims: [] } }]);
    assert.equal(map[0].title, 'Раздел 4');
  });
});

describe('mergeAudit — overall score from the merged parts', () => {
  test('before verification an unchecked High does not cap; a checklist absence does', () => {
    // Axes 80/80/80/80 → mean 80, cap 75: the two differ, so each case is
    // distinguishable. The stored score is recomputed after verification.
    const unverified = mergeAudit([ok(0, 5_000, axes(80, 80), [issue('цитата из документа', 'High')])], []);
    assert.equal(unverified.overallScore, 80);
    // The checklist ran and brought nothing: every question is "нет".
    const withAbsence = mergeAudit([ok(0, 5_000, axes(80, 80))], [], {
      documentText: 'текст', claims: [], contradictions: [], checklist: [],
    });
    assert.equal(withAbsence.overallScore, 75);
    assert.equal(withAbsence.checklist?.length, AUDIT_CHECKLIST.length);
  });

  test('a finding quoting a running footer is dropped; a table-row Critical becomes High', () => {
    const footer = 'Синтетический образец — цифры вымышлены для проверки';
    const doc = [
      ...['первый', 'второй', 'третий', 'четвёртый', 'пятый'].map((w) => `${w} абзац текста документа, в котором говорится что-то важное.\n${footer}`),
      'Показатель2023202420252026',
      'Онлайн-займы18,622,426,129,3',
      'Как видно из таблицы, онлайн-займы выросли.',
    ].join('\n');
    const merged = mergeAudit([ok(0, 5_000, axes(80, 80), [
      issue('Синтетический образец — цифры вымышлены', 'Critical'),
      issue('Онлайн-займы18,622,426,129,3', 'Critical'),
      issue('Как видно из таблицы, онлайн-займы выросли.', 'Critical'),
    ])], [], { documentText: doc, claims: [], contradictions: [], checklist: null });
    assert.equal(merged.issues.some((i) => i.quote.startsWith('Синтетический')), false, 'footer quote dropped');
    assert.equal(merged.issues.find((i) => i.quote.startsWith('Онлайн'))?.severity, 'High', 'table row lowered');
    assert.equal(merged.issues.find((i) => i.quote.startsWith('Как видно'))?.severity, 'Critical', 'prose left alone');
  });
});

describe('judgeChecklist — the verdict is code, the model only brings a sentence (stage 0a)', () => {
  const doc = 'Решение принято, потому что инфляция выше цели. Ставки по депозитам вырастут, и вкладчики получат больше. Прочий текст.';
  const ev = (id: string, quote: string) => ({ id, section: '1.', quote });

  test('one verbatim sentence is "есть"; empty, two sentences, a reworded one and a skipped question are "нет"', () => {
    const out = judgeChecklist([
      ev('decision-reason', 'Решение принято, потому что инфляция выше цели.'),
      ev('next-steps-conditions', 'Ставки по депозитам вырастут, и вкладчики получат больше. Прочий текст.'),
      ev('numbers-units-base', ''),
      ev('main-conclusion-first', 'Ставки по кредитам для бизнеса снизятся.'),
    ], doc)!;
    const by = Object.fromEntries(out.map((a) => [a.id, a]));
    assert.equal(by['decision-reason'].answer, 'есть');
    assert.equal(by['decision-reason'].reason, '');
    assert.equal(by['next-steps-conditions'].answer, 'нет');
    assert.match(by['next-steps-conditions'].reason, /больше одного предложения/);
    assert.equal(by['numbers-units-base'].answer, 'нет');
    assert.equal(by['main-conclusion-first'].answer, 'нет');
    assert.match(by['main-conclusion-first'].reason, /не найдено в документе дословно/);
    assert.equal(by['terms-explained'].answer, 'нет', 'a question the model skipped');
    assert.equal(out.length, AUDIT_CHECKLIST.length, 'every question gets a verdict');
  });

  test('"main conclusion first" also needs the sentence at the start: first section or first 1 500 characters', () => {
    const filler = 'Длинный абзац о второстепенном, который читатель проходит прежде, чем узнает решение. '.repeat(30);
    const late = `Резюме общими словами без решения. ${filler}Комитет сохранил базовую ставку на уровне 16,25%. Конец.`;
    const quote = 'Комитет сохранил базовую ставку на уровне 16,25%.';
    const verdict = (doc: string, first: string) => judgeChecklist([ev('main-conclusion-first', quote)], doc, first)!
      .find((a) => a.id === 'main-conclusion-first')!;
    assert.equal(verdict(late, 'Резюме общими словами без решения.').answer, 'нет');
    assert.match(verdict(late, 'Резюме общими словами без решения.').reason, /не в начале/);
    assert.equal(verdict(late, late).answer, 'есть', 'inside a long first section');
    assert.equal(verdict(`${quote} ${filler}`, '').answer, 'есть', 'within the first 1 500 characters');
    assert.equal(startsEarly(quote, late, ''), false);
  });

  test('a checklist that did not run stays null — not "everything is missing"', () => {
    assert.equal(judgeChecklist(null, doc), null);
  });

  test('only "нет" becomes an absence, with the severity from config and no quote', () => {
    const out = checklistIssues([
      { id: 'decision-reason', answer: 'нет', section: '', quote: 'отклонённая цитата', reason: 'x' },
      { id: 'terms-explained', answer: 'есть', section: '', quote: 'x', reason: '' },
      { id: 'next-steps-conditions', answer: 'частично', section: '', quote: 'x', reason: '' },
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].kind, out[0].severity, out[0].quote, out[0].checkId], ['absence', 'High', '', 'decision-reason']);
  });
});

describe('contradiction candidates — paired in code (stage 0a)', () => {
  const doc = 'Инфляционные ожидания населения в октябре стабилизировались и не демонстрируют признаков дальнейшего роста. … '
    + 'Вместе с тем в базовом сценарии учитывается, что инфляционные ожидания населения продолжают расти в отдельных группах и регионах. … '
    + 'Ожидается, что инфляционные ожидания населения снизятся в следующем году. … Цены на нефть выросли за месяц.';
  const claim = (id: number, section: string, phenomenon: string, direction: ClaimDirection, type: 'факт' | 'прогноз', quote: string) =>
    ({ id, section, phenomenon, direction, type, quote });
  const s3 = claim(1, '3. Ожидания', 'инфляционные ожидания населения', 'стабилизировалось', 'факт',
    'Инфляционные ожидания населения в октябре стабилизировались и не демонстрируют признаков дальнейшего роста.');
  const s7 = claim(2, '7.1 Сценарий', 'инфляционные ожидания населения в отдельных группах', 'растёт', 'факт',
    'инфляционные ожидания населения продолжают расти в отдельных группах и регионах');

  test('the planted pair: one phenomenon, opposite directions, both facts, two sections', () => {
    const c = contradictionCandidates([s3, s7], doc);
    assert.equal(c.length, 1);
    assert.deepEqual([c[0].a.id, c[0].b.id], [1, 2]);
  });

  test('not a candidate: same section, fact against forecast, growth that slows, another phenomenon, a quote not in the document', () => {
    const forecast = claim(3, '8. Прогноз', 'инфляционные ожидания населения', 'снижается', 'прогноз', 'Ожидается, что инфляционные ожидания населения снизятся в следующем году.');
    const slows = { ...s7, id: 4, direction: 'замедляется' as const };
    const oil = claim(5, '4. Внешние', 'цены на нефть', 'растёт', 'факт', 'Цены на нефть выросли за месяц.');
    const invented = { ...s7, id: 6, quote: 'Этой фразы в документе нет вовсе.' };
    const sameSection = { ...s7, id: 7, section: s3.section };
    for (const other of [forecast, slows, oil, invented, sameSection]) {
      assert.equal(contradictionCandidates([s3, other], doc).length, 0, `claim ${other.id}`);
    }
  });

  test('direction pairs: growth and stabilisation are opposite, growth and slowing are not', () => {
    assert.equal(opposite('растёт', 'стабилизировалось'), true);
    assert.equal(opposite('ускоряется', 'замедляется'), true);
    assert.equal(opposite('растёт', 'замедляется'), false);
    assert.equal(opposite('растёт', 'растёт'), false);
  });

  test('phenomenon matching ignores the period and accepts a narrower group', () => {
    assert.equal(samePhenomenon('Инфляционные ожидания населения, октябрь 2026', 'инфляционные ожидания населения'), true);
    assert.equal(samePhenomenon('инфляционные ожидания населения', 'инфляционные ожидания населения в отдельных группах'), true);
    assert.equal(samePhenomenon('инфляционные ожидания населения', 'ожидания бизнеса'), false);
    assert.equal(samePhenomenon('инфляция', 'инфляция услуг'), false, 'one word is too little to call it the same');
  });
});

describe('contradictions → findings (stage 0a)', () => {
  const doc = 'Ожидания населения стабилизировались и не растут. … Ожидания населения продолжают расти в отдельных группах.';
  const c = (id: number, section: string, quote: string) =>
    ({ id, section, phenomenon: 'ожидания населения', direction: 'растёт' as const, type: 'факт' as const, quote });
  const claims = [
    c(1, '3. Ожидания', 'Ожидания населения стабилизировались и не растут.'),
    c(2, '7.1 Сценарий', 'Ожидания населения продолжают расти в отдельных группах.'),
    c(3, '7.1 Сценарий', 'Этой фразы в документе нет.'),
    c(4, '3. Ожидания', 'Ожидания населения продолжают расти в отдельных группах.'),
  ];

  test('kept with two verbatim quotes from different sections', () => {
    const out = contradictionIssues([{ a: 1, b: 2, title: 'противоречие' }], claims, doc);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].kind, out[0].section, out[0].section2], ['contradiction', '3. Ожидания', '7.1 Сценарий']);
  });

  test('dropped when a quote is not in the document', () => {
    assert.equal(contradictionIssues([{ a: 1, b: 3, title: 'x' }], claims, doc).length, 0);
  });

  test('dropped when both claims come from the same section', () => {
    assert.equal(contradictionIssues([{ a: 1, b: 4, title: 'x' }], claims, doc).length, 0);
  });

  test('a pair named twice is reported once', () => {
    assert.equal(contradictionIssues([{ a: 1, b: 2, title: 'x' }, { a: 2, b: 1, title: 'y' }], claims, doc).length, 1);
  });
});

describe('collapseAudiences — one finding per audience per document', () => {
  test('the most severe copy is kept and lists every section; other findings are untouched', () => {
    const a = (section: string, severity: string, audience?: 'depositors' | 'borrowers') => ({ title: section, severity, section, audience });
    const out = collapseAudiences([
      a('1. Решение', 'Medium', 'depositors'),
      a('2. Инфляция', 'High'),
      a('5.2 Депозиты', 'High', 'depositors'),
      a('5.3 Кредиты', 'Medium', 'borrowers'),
      a('8. Решения', 'High', 'depositors'),
    ]);
    assert.deepEqual(out.map((i) => [i.title, i.severity, i.section]), [
      ['2. Инфляция', 'High', '2. Инфляция'],
      ['5.2 Депозиты', 'High', '1. Решение; 5.2 Депозиты; 8. Решения'],
      ['5.3 Кредиты', 'Medium', '5.3 Кредиты'],
    ]);
  });

  test('mergeIssues applies it across sections', () => {
    const withAudience = (quote: string, severity: string) => ({ ...issue(quote, severity), audience: 'business' as const });
    const out = mergeIssues([
      ok(0, 5_000, axes(70, 70), [withAudience('цитата раздела один', 'Medium')]),
      ok(1, 5_000, axes(70, 70), [withAudience('цитата раздела два', 'High')]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'High');
  });
});
