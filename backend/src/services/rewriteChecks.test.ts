import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdits, CARD_CONTEXT, checkDecision, checkItem, checkSupport, documentNumbers, EditContext, issueStatus, longestSentence,
  missingNumbers, mustBePlaceholder, numbersIn, placeholdersIn, RawEdit, sectionParagraphs, splitParagraphs, summarize,
  SupportSource, supportIn, unchangedIntegrity, unexplainedTerms,
} from './rewriteChecks';
import type { DecisionReference } from '../validators/audienceAnalysis.validator';

// A1 stage 3: the checks of the three versions. Each only marks; an edit of
// the full text that does not stand on the document is dropped.

const DOC = 'ПРЕСС-РЕЛИЗ О снижении базовой ставки до 16,25%. Комитет принял решение 04.09.2026 установить ставку на уровне 16,25% годовых с коридором +/- 1 п.п. Инфляция замедлилась до 12,1%, рост ВВП — 1 200 млрд тенге.';
const docNumbers = documentNumbers(DOC);
const src: SupportSource = { quoteText: DOC, sections: [DOC], minCoverage: 0.75, authorCheckBelow: 0.7 };

describe('numbers', () => {
  test('«16,25%» and «16.25 %» are one number; dates count by day, month and year; thousands with a space', () => {
    assert.deepEqual(numbersIn('16,25% и 16.25 %').map((n) => n.value), ['16.25', '16.25']);
    assert.deepEqual(numbersIn('решение 04.09.2026').map((n) => n.value), ['4', '9', '2026']);
    assert.deepEqual(numbersIn('1 200 млрд').map((n) => n.value), ['1200']);
  });

  test('a number the document lacks is reported; words and placeholders are not counted', () => {
    assert.deepEqual(missingNumbers('Ставка снижена до 16.25 %, инфляция 12,1%.', docNumbers), []);
    assert.deepEqual(missingNumbers('Ставка снизится до 15% в 2027 году.', docNumbers), ['15', '2027']);
    assert.deepEqual(missingNumbers('Шестнадцать процентов. [Дописать: прогноз на 2027 год — в документе этого нет]', docNumbers), []);
  });
});

describe('the decision', () => {
  const field = (value: string | number | null) => ({ value, proposed: value, quote: '', verified: value !== null, reason: '' });
  const ref = { direction: field('lower'), value: field(16.25) } as unknown as DecisionReference;

  test('direction word and value both present: ok; one missing: marked', () => {
    assert.deepEqual(checkDecision('Национальный Банк снизил базовую ставку до 16,25%.', ref), { ok: true, reason: '' });
    assert.match(checkDecision('Национальный Банк установил ставку 16,25%.', ref)!.reason, /не названо направление/);
    assert.match(checkDecision('Национальный Банк снизил ставку.', ref)!.reason, /не названа величина/);
  });

  test('no verified field: not checked', () => {
    assert.equal(checkDecision('что угодно', { direction: field(null), value: field(null) } as unknown as DecisionReference), null);
    assert.equal(checkDecision('что угодно', null), null);
  });
});

describe('terms and length', () => {
  test('a dictionary term without brackets is marked; with an explanation right after it, or inside brackets, it is not', () => {
    assert.deepEqual(unexplainedTerms('Сохраняется дезинфляция цен.'), ['дезинфляция']);
    assert.deepEqual(unexplainedTerms('Сохраняется дезинфляция (замедление роста цен).'), []);
    assert.deepEqual(unexplainedTerms('Цены растут медленнее (дезинфляция).'), []);
  });

  test('the longest sentence in words; a decimal comma does not end a sentence', () => {
    assert.equal(longestSentence('Ставка 16,25 процента. Это два слова.'), 3);
  });
});

describe('support by a verbatim basis (04.11.2026)', () => {
  const BASIS = 'Комитет принял решение 04.09.2026 установить ставку на уровне 16,25% годовых с коридором +/- 1 п.п.';

  test('a restatement of its basis stands', () => {
    const s = checkSupport('Комитет установил ставку на уровне 16,25% годовых.', BASIS, src);
    assert.equal(s.ok, true);
    assert.equal(s.basisVerified, true);
  });

  test('an invented consequence fails: its words are not in the basis or its section', () => {
    const s = checkSupport('Снижение ставки приведёт к снижению доходности по новым депозитам.', BASIS, src);
    assert.equal(s.ok, false);
    assert.match(s.reason, /нет в опоре: .*доходности/);
  });

  test('a number outside the basis and its section fails; a basis not in the document fails; no basis fails', () => {
    assert.match(checkSupport('Ставка установлена на уровне 15% годовых.', BASIS, src).reason, /числа не в опоре: 15/);
    assert.equal(checkSupport('Ставка установлена.', 'Совет директоров решил.', src).reason, 'опора не найдена в документе дословно');
    assert.equal(checkSupport('Ставка установлена.', '', src).reason, 'нет опоры');
  });

  test('service words do not count; coverage is a share of significant stems', () => {
    assert.equal(supportIn('Это значит, что для вас ставка установлена.', BASIS, 0.75).ok, true);
    assert.equal(supportIn('Ставка установлена туризмом.', BASIS, 0.75).coverage, 0.67);
  });
});

describe('«не указано» instead of a placeholder', () => {
  test('saying the document is silent is marked; a placeholder saying so is not', () => {
    assert.equal(mustBePlaceholder('Конкретные пороги в документе не указаны.'), true);
    assert.equal(mustBePlaceholder('Документ не содержит условий по вкладам.'), true);
    assert.equal(mustBePlaceholder('Об этом не сообщается.'), true);
    assert.equal(mustBePlaceholder('[Дописать: пороги — в документе этого нет]'), false);
    assert.equal(mustBePlaceholder('Ставка не изменилась.'), false);
  });
});

describe('an item', () => {
  test('a placeholder is one by its text; an unsupported statement is marked; summary counts', () => {
    const ctx = CARD_CONTEXT(docNumbers, src);
    const ph = checkItem({ text: '[Дописать: что решение значит для вкладов — в документе этого нет]', basis: '', sourceSections: [2], placeholder: false }, ctx);
    assert.equal(ph.placeholder, true);
    assert.deepEqual(ph.sourceSections, []);
    assert.equal(ph.checks.support, null);
    const bare = checkItem({ text: 'Ставка снизится до 15%.', basis: '', sourceSections: [], placeholder: false }, ctx);
    assert.deepEqual([bare.checks.unsourced, bare.checks.numbers, bare.checks.support!.ok], [true, ['15'], false]);
    const silent = checkItem({ text: 'Пороги в документе не указаны.', basis: '', sourceSections: [1], placeholder: false }, ctx);
    const s = summarize([ph, bare, silent], { min: 10, max: 2000 });
    assert.deepEqual([s.placeholders.length, s.numbersNotFound, s.unsupported, s.mustBePlaceholder, s.marks], [1, 1, 2, 1, 2]);
  });

  test('placeholders are found in any text', () => {
    assert.deepEqual(placeholdersIn('А [Дописать: x — в документе этого нет] и [Дописать: y]'), ['[Дописать: x — в документе этого нет]', '[Дописать: y]']);
  });
});

describe('paragraphs of the full text', () => {
  const SECTION = 'Заголовок раздела\n\nПервый абзац текста про базовую ставку.\nЕго продолжение.\n\n\nВторой абзац про инфляцию 12,1%.\n\nТретий абзац без перевода строки';

  test('paragraphs partition the section exactly', () => {
    const ps = splitParagraphs(SECTION);
    assert.equal(ps.map((p) => SECTION.slice(p.start, p.end)).join(''), SECTION);
    assert.equal(ps.length, 4);
  });

  test('a long PDF block is cut at line breaks after a sentence', () => {
    const block = Array.from({ length: 40 }, (_, i) => `Предложение номер ${i} довольно длинное, чтобы набрать объём текста.`).join('\n');
    const ps = splitParagraphs(block);
    assert.ok(ps.length > 1);
    assert.equal(ps.map((p) => block.slice(p.start, p.end)).join(''), block);
  });

  const DOCUMENT = `Начало документа.\n\n${SECTION}`;
  const start = DOCUMENT.indexOf(SECTION);
  const paragraphs = sectionParagraphs(2, SECTION, start);
  const ctx: EditContext = {
    issueIds: new Set(['З-01']), missingIds: new Set(['N1']), docNumbers: documentNumbers(DOCUMENT),
    support: { quoteText: DOCUMENT, sections: [SECTION], minCoverage: 0.75, authorCheckBelow: 0.7 },
    isTerm: (term, text) => term === 'дезинфляция' && text.includes('дезинфляция'),
  };
  const edit = (e: Partial<RawEdit>): RawEdit => ({ paragraphId: 's3p2', action: 'replace', kind: '', text: '', sentences: [], term: '', reason: '', issueId: 'З-01', missingId: '', ...e });

  test('kinds: a replacement backed by its paragraph, a pure placeholder, from_document with a basis, a term definition — kept', () => {
    const r = applyEdits(paragraphs, [
      edit({ text: 'Первый абзац текста про базовую ставку, продолжение.' }),
      edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'placeholder', text: '[Дописать: что это значит для вкладов — в документе этого нет]', issueId: '', missingId: 'N1' }),
      edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'from_document', sentences: [{ text: 'Инфляция — 12,1%.', basis: 'Второй абзац про инфляцию 12,1%.' }] }),
      edit({ paragraphId: 's3p4', action: 'insert_after', kind: 'term_definition', term: 'дезинфляция', text: 'дезинфляция — замедление роста цен.' }),
    ], ctx);
    assert.equal(r.applied, 4);
    assert.deepEqual(r.dropped, { unknownParagraph: 0, noLink: 0, duplicate: 0, newContent: 0 });
    assert.deepEqual(r.paragraphs.map((p) => [p.id, p.status, p.kind]), [
      ['s3p1', 'same', null], ['s3p2', 'changed', null], ['s3p3', 'same', null], ['s3p3+1', 'added', 'placeholder'],
      ['s3p3+2', 'added', 'from_document'], ['s3p4', 'same', null], ['s3p4+1', 'added', 'term_definition'],
    ]);
    assert.equal(r.paragraphs[1]!.before, paragraphs[1]!.text);
    assert.equal(r.paragraphs[1]!.text, 'Первый абзац текста про базовую ставку, продолжение.\n\n\n', 'the separator of the source paragraph is kept');
    assert.deepEqual(r.paragraphs[4]!.checks!.bases, ['Второй абзац про инфляцию 12,1%.']);
    assert.equal(r.paragraphs[6]!.checks!.authorCheck, true);
    assert.deepEqual(unchangedIntegrity(r.paragraphs, DOCUMENT, paragraphs), { same: 3, matching: 3 });
  });

  test('new content is dropped and counted: a replacement with claims not in its paragraph, a placeholder with text, an unbacked or unknown kind, a non-term', () => {
    const r = applyEdits(paragraphs, [
      edit({ text: 'Снижение ставки приведёт к удешевлению кредитов и снижению доходности депозитов.' }),
      edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'placeholder', text: 'Вклады подешевеют. [Дописать: x]' }),
      edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'from_document', sentences: [{ text: 'Сценарный анализ показывает ослабление тенге.', basis: 'Второй абзац про инфляцию 12,1%.' }] }),
      edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'opinion', text: 'Мнение.' }),
      edit({ paragraphId: 's3p4', action: 'insert_after', kind: 'term_definition', term: 'туризм', text: 'туризм — поездки.' }),
      edit({ paragraphId: 's9p9' }),
      edit({ paragraphId: 's3p4', issueId: 'З-99' }),
    ], ctx);
    assert.equal(r.applied, 0);
    assert.deepEqual(r.dropped, { unknownParagraph: 1, noLink: 1, duplicate: 0, newContent: 5 });
  });

  test('issue status: an edit on the paragraph with the quote, elsewhere, none', () => {
    const quote = 'Второй абзац про инфляцию 12,1%.';
    const on = applyEdits(paragraphs, [edit({ paragraphId: 's3p3', text: 'Второй абзац про инфляцию 12,1%.' })], ctx).paragraphs;
    const off = applyEdits(paragraphs, [edit({ text: 'Первый абзац текста про базовую ставку.' })], ctx).paragraphs;
    const insertAfter = applyEdits(paragraphs, [edit({ paragraphId: 's3p3', action: 'insert_after', kind: 'placeholder', text: '[Дописать: x]' })], ctx).paragraphs;
    assert.equal(issueStatus(quote, paragraphs, on, 'З-01'), 'in_quote_paragraph');
    assert.equal(issueStatus(quote, paragraphs, insertAfter, 'З-01'), 'in_quote_paragraph', 'an insertion counts by the paragraph it follows');
    assert.equal(issueStatus(quote, paragraphs, off, 'З-01'), 'wrong_paragraph');
    assert.equal(issueStatus(quote, paragraphs, paragraphs.map((p) => ({ ...p, status: 'same' as const, before: null, reason: '', issueId: null, missingId: null, kind: null, checks: null })), 'З-01'), 'no_edit');
  });
});

describe('«проверить автору» (04.11.2026)', () => {
  // The press release: one section, so «basis or its section» is the whole
  // document — the words were there, the relation was not.
  const PRESS = 'Замедлению роста цен будут способствовать умеренно жесткие денежно-кредитные условия и крепкий обменный курс. Дополнительное сдерживающее влияние окажет завершающий этап повышения минимальных резервных требований в сентябре 2026 года. Доступность кредитов для бизнеса остаётся высокой.';
  const press: SupportSource = { quoteText: PRESS, sections: [PRESS], minCoverage: 0.75, authorCheckBelow: 0.7 };
  const BASIS = 'Дополнительное сдерживающее влияние окажет завершающий этап повышения минимальных резервных требований в сентябре 2026 года.';

  test('backed by the section but weakly by the basis alone: confirmed, marked for the author', () => {
    const s = checkSupport('Доступность кредитов будет дополнительно ограничена завершающим этапом повышения минимальных резервных требований.', BASIS, press);
    assert.equal(s.ok, true);
    assert.equal(s.authorCheck, true);
    assert.ok(s.basisCoverage! < 0.7);
  });

  test('a close restatement of the basis: no mark', () => {
    const s = checkSupport('Дополнительное сдерживающее влияние окажет завершающий этап повышения минимальных резервных требований.', BASIS, press);
    assert.deepEqual([s.ok, s.authorCheck], [true, false]);
  });

  test('an unconfirmed statement is not also marked for the author', () => {
    assert.equal(checkSupport('Туризм вырастет.', BASIS, press).authorCheck, false);
  });
});

describe('replacements of the full text (04.11.2026)', () => {
  // The press release, s1p16: the replacement moved «(ранее 3,5-4,5%)» from
  // 2028 to 2027 and dropped the 2026 and 2028 forecasts — every word and
  // number was in the source paragraph, so support let it through.
  const BEFORE = 'Прогноз роста ВВП на 2026 год в базовом сценарии не претерпел изменений и оценивается на уровне 4,5-5,5%. Экономическая активность продолжит поддерживаться высокой инвестиционной активностью на фоне реализации программ квазифискального стимулирования и стабильного потребительского спроса. В сравнении с предпосылками прошлого прогнозного раунда Национального Банка и предыдущими параметрами Прогноза социально-экономического развития Правительства в 2027 году ожидается увеличение объемов фискального стимулирования, что окажет поддержку инвестиционной и потребительской активности. При этом более слабая прогнозная динамика нефтедобычи в 2027 году за счет переноса ремонта на ТШО с 2026 года на 2027 год будет отчасти нивелировать расширение внутреннего спроса. Рост ВВП в 2027 году сложится в пределах 4,5%. В 2028 году ожидается ускорение роста ВВП до 4-5% (ранее 3,5-4,5%), ввиду эффекта от реализации отраслевых и системных реформ, планируемого расширения фискального стимулирования, а также восстановления производства и экспорта нефти.\n\n';
  const AFTER = 'В 2027 году ожидается увеличение объемов фискального стимулирования, что окажет поддержку инвестиционной и потребительской активности. При этом более слабая прогнозная динамика нефтедобычи в 2027 году за счет переноса ремонта на ТШО с 2026 года на 2027 год будет отчасти нивелировать расширение внутреннего спроса. Рост ВВП в 2027 году сложится в пределах 4,5% (ранее 3,5-4,5%).';
  const paragraphs = sectionParagraphs(0, BEFORE, 0);
  const ctx: EditContext = {
    issueIds: new Set(['З-03']), missingIds: new Set(), docNumbers: documentNumbers(BEFORE),
    support: { quoteText: BEFORE, sections: [BEFORE], minCoverage: 0.75, authorCheckBelow: 0.7 },
    isTerm: () => false,
  };

  test('s1p16: the replacement stands on its paragraph, is marked for the author, and the dropped numbers are listed', () => {
    const r = applyEdits(paragraphs, [{ paragraphId: 's1p1', action: 'replace', kind: '', text: AFTER, sentences: [], term: '', reason: 'З-03', issueId: 'З-03', missingId: '' }], ctx);
    assert.equal(r.applied, 1, 'support alone lets it through — hence the marks');
    const p = r.paragraphs[0]!;
    assert.equal(p.status, 'changed');
    assert.equal(p.checks!.authorCheck, true);
    // The 2026 forecast (4,5-5,5%) and the whole 2028 sentence (2028, 4-5%).
    assert.deepEqual(p.checks!.removedNumbers, ['5,5', '2028', '4', '5']);
  });

  test('a replacement keeping every number: marked for the author, nothing removed', () => {
    const r = applyEdits(sectionParagraphs(0, 'Инфляция замедлилась до 9,8% в августе.\n\n', 0), [{ paragraphId: 's1p1', action: 'replace', kind: '', text: 'В августе инфляция замедлилась до 9,8%.', sentences: [], term: '', reason: '', issueId: 'З-03', missingId: '' }], { ...ctx, docNumbers: documentNumbers('9,8') });
    assert.deepEqual([r.paragraphs[0]!.checks!.authorCheck, r.paragraphs[0]!.checks!.removedNumbers], [true, []]);
  });
});
