import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQuoteRules, fromTable, inRunningLine, isTableRow, isTextTableMismatch, quoteRegions, tableBlocks, textForQuotes,
} from './auditQuoteRules';
import { isVerbatimQuote } from './promptSafety';

// A1 stage 0a, decision of 03.11.2026. The lines below are what pdf-parse made
// of the test documents and the NBK reports.

describe('isTableRow — a glued or spaced table line, not prose with numbers', () => {
  test('rows', () => {
    for (const l of ['Онлайн-займы18,622,426,129,3', '1 1201 5401 8902 170', 'Показатель2023202420252026',
      'Средняя ставка вознаграждения39,441,242,743,5', '4,5-5,5 3,5-4,5 4,0-5,0']) {
      assert.equal(isTableRow(l), true, l);
    }
  });

  test('prose', () => {
    for (const l of ['микрофинансовых организаций увеличились до 29,3 и 17,6 соответственно, при этом списания и',
      'Месячная инфляция в августе составила 0,6% (0,6% в июле), с очисткой от сезонных',
      'Синтетический тестовый документ. Не является публикацией Национального Банка Казахстана.  ·  стр. 7',
      // Wrapped tails of NBK report paragraphs.
      'уровням и будут в диапазоне 3,5-4,5% (график 5).',
      'График 10. В 1 квартале 2026 года основной',
      'контрольной группе: на 8% в зоне 300–700 м и на 10,5% — в зоне 700–1000 м.']) {
      assert.equal(isTableRow(l), false, l);
    }
  });
});

describe('tableBlocks and the two rules', () => {
  const footer = '[ТЕСТ] Синтетический образец — цифры вымышлены';
  const doc = [
    // Paragraphs differ in words, not only in a digit: digits are masked, and
    // five lines differing by a digit are a running line themselves.
    ...['первый', 'второй', 'третий', 'четвёртый', 'пятый'].map((w) => `${w} абзац: инфляция замедлилась, и это видно по многим показателям.\n${footer}`),
    'Показатель2023202420252026',
    'Портфель микрофинансовых ',
    'организаций',
    '1 1201 5401 8902 170',
    'Онлайн-займы18,622,426,129,3',
    'Как   видно   из   таблицы,   онлайн-займы   и   просроченная   задолженность   в   секторе ',
  ].join('\n');
  const r = quoteRegions(doc);

  test('a wrapped row label stays inside its table', () => {
    assert.equal(tableBlocks(doc).length, 1);
    assert.equal(fromTable('Портфель микрофинансовых организаций 1 1201 5401 8902 170', r), true);
  });

  test('a quote of prose under the table is not from the table; a quote without digits never is', () => {
    assert.equal(fromTable('Как видно из таблицы, онлайн-займы и просроченная задолженность', r), false);
    assert.equal(fromTable('Портфель микрофинансовых организаций', r), false);
  });

  test('a running line is recognised, a part of it too; prose is not', () => {
    assert.equal(inRunningLine('Синтетический образец — цифры вымышлены', r), true);
    assert.equal(inRunningLine('инфляция замедлилась', r), false);
  });

  test('applyQuoteRules drops footer findings (either quote of a contradiction) and lowers only table-row Critical', () => {
    const out = applyQuoteRules([
      { quote: footer, severity: 'High' },
      { quote: 'инфляция замедлилась', quote2: footer, severity: 'High' },
      { quote: 'Онлайн-займы18,622,426,129,3', severity: 'Critical' },
      { quote: 'Онлайн-займы18,622,426,129,3', severity: 'Medium' },
      { quote: 'инфляция замедлилась', severity: 'Critical' },
    ], r);
    assert.deepEqual(out.map((i) => i.severity), ['High', 'Medium', 'Critical']);
  });
});

describe('textForQuotes — a sentence across a page break is still verbatim', () => {
  test('the footer and header lines between its halves are not part of the text', () => {
    const footer = 'Синтетический тестовый документ. Не является публикацией Банка.  ·  стр. 1';
    const header = '[ТЕСТ] Синтетический образец — цифры вымышлены';
    const pages = ['первая', 'вторая', 'третья', 'четвёртая', 'пятая'].map((w) => `${w} страница текста документа.\n${footer}\n\n${header}`);
    const doc = `Решение обусловлено тем, что инфляция остаётся выше\n${footer}\n\n${header}\nцели.\n${pages.join('\n')}`;
    const quote = 'Решение обусловлено тем, что инфляция остаётся выше цели.';
    assert.equal(isVerbatimQuote(quote, doc), false, 'against the raw text');
    assert.equal(isVerbatimQuote(quote, textForQuotes(doc)), true, 'against the text quotes are checked in');
  });
});

describe('isTextTableMismatch — text against a table is never Critical', () => {
  test('the titles of the acceptance false Criticals are recognised', () => {
    for (const t of [
      'Текст утверждает рост показателей, а таблица показывает их снижение',
      'Текст прогноза инфляции противоречит данным таблицы',
      'Противоречие между текстом прогноза роста ВВП и данными в таблице за 2027 год',
      'Текст содержит утверждение о снижении взносов, но таблица показывает обратное',
    ]) assert.equal(isTextTableMismatch(t), true, t);
  });

  test('other table findings and other contradictions are not', () => {
    for (const t of ['Таблица не содержит единиц измерения', 'Противоречие между резюме и разделом 7', 'Отсутствие пояснения термина TONIA']) {
      assert.equal(isTextTableMismatch(t), false, t);
    }
  });

  test('applyQuoteRules lowers such a Critical even when it quotes prose', () => {
    const r = quoteRegions('Онлайн-займы и просроченная задолженность увеличились до 29,3 и 17,6 соответственно.');
    const out = applyQuoteRules([
      { title: 'Текст утверждает рост, а таблица показывает снижение', quote: 'онлайн-займы и просроченная задолженность', severity: 'Critical' },
      { title: 'Документ можно понять противоположно', quote: 'онлайн-займы и просроченная задолженность', severity: 'Critical' },
    ], r);
    assert.deepEqual(out.map((i) => i.severity), ['High', 'Critical']);
  });
});
