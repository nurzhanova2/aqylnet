import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, DocumentSectionDraft } from './documentSections';
import { sectionsMatch } from './documentSection.service';

// A1 stage 0: sections are contiguous slices of the stored text. The invariant
// is what makes a quote found in one section checkable against the whole
// document, so every case below asserts it, not only the section count.

function assertInvariant(text: string, sections: DocumentSectionDraft[]) {
  assert.ok(sections.length > 0, 'a non-empty document has at least one section');
  assert.equal(sections[0].startOffset, 0, 'the first section starts at 0');
  assert.equal(sections[sections.length - 1].endOffset, text.length, 'the last section ends at the end');
  sections.forEach((s, i) => {
    assert.equal(text.slice(s.startOffset, s.endOffset), s.text, `section ${i}: slice === text`);
    assert.equal(s.order, i, 'orders are 0..n-1');
    if (i > 0) assert.equal(sections[i - 1].endOffset, s.startOffset, `no gap or overlap before section ${i}`);
  });
  assert.ok(sectionsMatch(text, sections.map((s) => ({ ...s }))), 'sectionsMatch agrees');
}

// Prose in the shape pdf-parse returns: ~95-character printed lines, no blank
// lines between paragraphs, the first line of a paragraph without a full stop.
// Lines must not repeat: five identical lines with fifteen letters are exactly
// what the running-header detector is built to recognise.
const WORDS = ['банк', 'ставка', 'инфляция', 'кредитование', 'регулятор', 'депозиты', 'ликвидность', 'спрос',
  'прогноз', 'решение', 'заёмщик', 'портфель', 'капитал', 'норматив', 'тенге', 'бюджет', 'тариф', 'услуги',
  'рынок', 'доходность', 'просрочка', 'ипотека', 'оценка', 'риск', 'комитет', 'сценарий', 'курс', 'резервы'];

function pdfParagraph(seed: number, lines = 6): string {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const out: string[] = [];
  for (let l = 0; l < lines; l++) {
    let line = '';
    while (line.length < 90) line += (line ? ' ' : '') + WORDS[Math.floor(rnd() * WORDS.length)];
    out.push(l === lines - 1 ? `${line}.` : line);
  }
  return out.join('\n');
}

function pdfSection(title: string, seed: number, paragraphs: number): string {
  return [title, ...Array.from({ length: paragraphs }, (_, i) => pdfParagraph(seed + i))].join('\n');
}

function withFooters(text: string, every = 40): string {
  // A running footer every `every` lines, the way page breaks land in pdf-parse output.
  const lines = text.split('\n');
  const out: string[] = [];
  lines.forEach((l, i) => {
    out.push(l);
    if (i > 0 && i % every === 0) out.push(`Синтетический тестовый документ. Не является публикацией · стр. ${i / every}`);
  });
  return out.join('\n');
}

describe('splitDocument — numbered headings (PDF-shaped)', () => {
  const titles = ['1. Решение по базовой ставке', '2. Инфляция и её факторы', '2.1 Продовольственная инфляция',
    '3. Инфляционные ожидания', '4. Внешние условия', '5. Денежный рынок'];
  const text = withFooters(['Резюме', pdfParagraph(1), pdfParagraph(2), ...titles.map((t, i) => pdfSection(t, 10 + i * 5, 12))].join('\n'));
  const { method, sections } = splitDocument(text);

  test('finds the numbered structure', () => assert.equal(method, 'numbered'));
  test('keeps the invariant', () => assertInvariant(text, sections));
  test('every section starts at a heading, and sizes respect the bounds', () => {
    for (const s of sections) {
      assert.ok(s.heading, 'headed');
      assert.ok(s.text.startsWith(s.heading!.split(' / ')[0]), 'the slice begins with its first heading');
      assert.ok(s.text.length <= 9_000 * 1.2, `section of ${s.text.length} is within the bound`);
    }
  });
  test('running footers are never taken for headings', () => {
    assert.ok(sections.every((s) => !s.heading?.includes('Синтетический')));
  });
});

describe('splitDocument — unnumbered headings (DOCX-shaped)', () => {
  // mammoth: one paragraph per line, blank line between, table cells as short paragraphs.
  const para = (seed: number) => pdfParagraph(seed, 5).replace(/\n/g, ' ');
  const table = ['Показатель', '2023', '2024', 'Кредитный портфель, трлн тенге', '28,6', '33,9'].join('\n\n');
  const titles = ['Основные выводы', 'Банковский сектор: капитал и ликвидность', 'Качество кредитного портфеля',
    'Ипотека и рынок жилья', 'Стресс-тестирование банков'];
  const body = titles.map((t, i) => [t, ...Array.from({ length: 12 }, (_, k) => para(i * 20 + k)), table].join('\n\n'));
  const text = body.join('\n\n');
  const { method, sections } = splitDocument(text);

  test('finds headings by shape', () => assert.equal(method, 'unnumbered'));
  test('keeps the invariant', () => assertInvariant(text, sections));
  test('a table row label with a comma is not a heading', () => {
    assert.ok(sections.every((s) => !s.heading?.includes('Кредитный портфель')));
  });
});

describe('splitDocument — NBK report layout', () => {
  // Monetary-policy reports number chapters I–VII and are full of figure, box
  // and table captions on their own lines.
  const chapters = ['I. Решение по базовой ставке', 'II. Инфляция', 'III. Внешние условия', 'IV. Денежный рынок',
    'V. Кредитование', 'VI. Бюджетная политика', 'VII. Прогноз и риски'];
  const captions = ['График 1.1 Годовая инфляция по компонентам', 'Бокс 2. Что такое нейтральная ставка',
    'Таблица 3', 'Рисунок 4 Динамика курса тенге', 'Источник: НБК, БНС АСПиР', 'Бокс. Как читать прогноз'];
  const text = chapters.map((c, i) => [
    c,
    pdfParagraph(100 + i * 10),
    pdfParagraph(101 + i * 10),
    captions[i % captions.length],
    ...Array.from({ length: 8 }, (_, k) => pdfParagraph(102 + i * 10 + k)),
  ].join('\n')).join('\n');
  const { method, sections } = splitDocument(text);

  test('roman numerals I–VII are chapter headings', () => {
    assert.equal(method, 'numbered');
    const headings = sections.flatMap((s) => (s.heading ?? '').split(' / '));
    for (const c of chapters) assert.ok(headings.includes(c), `${c} starts a section`);
  });

  test('figure, box and table captions never become sections', () => {
    const headings = sections.map((s) => s.heading ?? '').join(' | ');
    for (const c of captions) assert.ok(!headings.includes(c.split(' ')[0] + ' '), `${c} is not a heading`);
    assert.ok(!/График|Бокс|Таблица|Рисунок|Источник/.test(headings));
  });

  test('keeps the invariant', () => assertInvariant(text, sections));

  test('a roman numeral inside running text is not a heading', () => {
    const t = [pdfSection('1. Раздел', 1, 6), 'IV квартал отличался ростом цен на услуги и топливо по стране', pdfParagraph(2),
      pdfSection('2. Раздел', 3, 6), pdfSection('3. Раздел', 5, 6)].join('\n');
    const hs = splitDocument(t).sections.map((s) => s.heading ?? '').join(' | ');
    assert.ok(!hs.includes('IV квартал'));
  });
});

describe('splitDocument — rules measured on the NBK reports (Feb and Aug 2026)', () => {
  // The shape of those reports, reduced: title page, contents with page
  // numbers, a decision page in capitals, chapters whose first line is a
  // subheading, three-level numbering, a heading ending in a bracket.
  const text = [
    'ДЕНЕЖНО-КРЕДИТНАЯ ПОЛИТИКА НАЦИОНАЛЬНОГО БАНКА', pdfParagraph(300, 4),
    'ОГЛАВЛЕНИЕ',
    'РЕШЕНИЕ ПО БАЗОВОЙ СТАВКЕ ОТ 6 МАРТА 2026 ГОДА 4',
    'I. ПЕРСПЕКТИВЫ РАЗВИТИЯ ЭКОНОМИКИ 5',
    '1.1. Ключевые внешние предпосылки прогноза 5',
    'II. ТЕКУЩИЕ МАКРОЭКОНОМИЧЕСКИЕ УСЛОВИЯ 13',
    'III. ТРАНСМИССИОННЫЙ МЕХАНИЗМ ДЕНЕЖНО-КРЕДИТНОЙ ПОЛИТИКИ 22',
    'РЕШЕНИЕ ПО БАЗОВОЙ СТАВКЕ ОТ 6 МАРТА 2026 ГОДА', ...Array.from({ length: 6 }, (_, k) => pdfParagraph(310 + k)),
    'I. ПЕРСПЕКТИВЫ РАЗВИТИЯ ЭКОНОМИКИ',
    '1.1. Ключевые внешние предпосылки прогноза',
    '1.1.1. Товарные рынки', ...Array.from({ length: 12 }, (_, k) => pdfParagraph(320 + k)),
    'II. ТЕКУЩИЕ МАКРОЭКОНОМИЧЕСКИЕ УСЛОВИЯ',
    '2.1. Инфляция', ...Array.from({ length: 12 }, (_, k) => pdfParagraph(340 + k)),
    '2.3. Фискальная политика', ...Array.from({ length: 4 }, (_, k) => pdfParagraph(360 + k)),
    'III. ТРАНСМИССИОННЫЙ МЕХАНИЗМ ДЕНЕЖНО-КРЕДИТНОЙ ПОЛИТИКИ',
    '3.1.2. Кредитный канал и депозиты (канал благосостояния)', ...Array.from({ length: 6 }, (_, k) => pdfParagraph(370 + k)),
    '3.2. Денежная масса', 'Темпы роста денежной массы ускорились.', ...Array.from({ length: 6 }, (_, k) => pdfParagraph(380 + k)),
  ].join('\n');
  const { sections } = splitDocument(text);
  const heads = sections.flatMap((s) => (s.heading ?? '').split(' / ')).filter(Boolean);

  test('keeps the invariant', () => assertInvariant(text, sections));

  test('contents entries (title + page number) are not headings', () => {
    assert.ok(!heads.some((h) => /\s\d{1,3}$/.test(h)), JSON.stringify(heads));
  });

  test('a heading in capitals with digits is found — the decision page', () => {
    assert.ok(heads.includes('РЕШЕНИЕ ПО БАЗОВОЙ СТАВКЕ ОТ 6 МАРТА 2026 ГОДА'));
  });

  test('a chapter followed straight by its subheading is found and starts its section', () => {
    for (const ch of ['I. ПЕРСПЕКТИВЫ РАЗВИТИЯ ЭКОНОМИКИ', 'II. ТЕКУЩИЕ МАКРОЭКОНОМИЧЕСКИЕ УСЛОВИЯ', 'III. ТРАНСМИССИОННЫЙ МЕХАНИЗМ ДЕНЕЖНО-КРЕДИТНОЙ ПОЛИТИКИ']) {
      const s = sections.find((x) => (x.heading ?? '').split(' / ').includes(ch));
      assert.ok(s, `${ch} is a heading`);
      assert.ok(s!.text.startsWith(ch), `${ch} opens its section rather than ending the previous one`);
    }
  });

  test('three-level numbers, a bracket at the end and a short lead line are headings', () => {
    for (const h of ['1.1.1. Товарные рынки', '3.1.2. Кредитный канал и депозиты (канал благосостояния)', '3.2. Денежная масса']) {
      assert.ok(heads.includes(h), `${h} found`);
    }
  });

  test('a short last subsection does not borrow the next chapter', () => {
    const fiscal = sections.find((s) => (s.heading ?? '').includes('2.3. Фискальная политика'))!;
    assert.ok(!fiscal.text.includes('III. ТРАНСМИССИОННЫЙ'), 'chapter III is not inside 2.3');
  });
});

describe('splitDocument — fallback and edges', () => {
  test('no headings: cut by paragraphs into sections near the target size', () => {
    const text = Array.from({ length: 80 }, (_, i) => pdfParagraph(i, 3).replace(/\n/g, ' ')).join('\n\n');
    const { method, sections } = splitDocument(text);
    assert.equal(method, 'fallback');
    assertInvariant(text, sections);
    assert.ok(sections.length > 1, 'a long document is cut');
    assert.ok(sections.every((s) => s.text.length <= 9_000), 'no piece over the maximum');
  });

  test('a short document is one section', () => {
    const text = 'Короткий текст без заголовков.\nВторая строка.';
    const { sections } = splitDocument(text);
    assert.equal(sections.length, 1);
    assertInvariant(text, sections);
  });

  test('CRLF line endings keep offsets exact', () => {
    const text = ['Резюме', pdfParagraph(1), '1. Первый раздел', pdfSection('', 3, 10), '2. Второй раздел', pdfSection('', 9, 10), '3. Третий раздел', pdfSection('', 15, 10)]
      .join('\n').replace(/\n/g, '\r\n');
    assertInvariant(text, splitDocument(text).sections);
  });

  test('an empty document has no sections', () => {
    assert.deepEqual(splitDocument('').sections, []);
    assert.deepEqual(splitDocument('   \n ').sections, []);
  });

  test('sectionsMatch notices a document that changed under its sections', () => {
    const text = pdfSection('1. Раздел', 1, 30);
    const rows = splitDocument(text).sections;
    assert.equal(sectionsMatch(text + ' дописано', rows), false);
  });
});
