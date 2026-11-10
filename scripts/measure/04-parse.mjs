// Step 4: real documents through the product's own parse path.
//
// parseDocument() from the compiled backend is what POST /documents/upload
// calls after multer has stored the file: signature check, DOCX archive
// screening, then pdf-parse / mammoth in a worker under a time and heap limit.
// Only the HTTP layer is skipped — it stores the file and writes the result to
// the database, neither of which changes the text.
//
// For each file: size, characters per page, what survives of the headings, the
// splitter sketch from sections.mjs, and whether the defect keys' verbatim
// quotes are still verbatim in the extracted text — if the parser breaks them,
// the audit's "unverified" quotes are partly the parser's doing, not the model's.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { save, main, HERE, OUT } from './lib.mjs';
import { splitSections, cleanText, findHeadings, sizeStats } from './sections.mjs';
import { parseKey } from './keys.mjs';

const require = createRequire('/app/package.json');
const { parseDocument } = require('/app/dist/services/documentParser.js');
const { isVerbatimQuote } = require('/app/dist/services/promptSafety.js');

const IN = path.join(HERE, 'in');
const DOCS = [
  { file: 'test1_obzor_dkp.pdf', pages: 13, key: 'test1_klyuch_oshibok.md' },
  { file: 'test1_obzor_dkp.docx', pages: 13, key: 'test1_klyuch_oshibok.md' },
  { file: 'test2_finstabilnost.pdf', pages: 11, key: 'test2_klyuch_oshibok.md' },
  { file: 'test2_finstabilnost.docx', pages: 11, key: 'test2_klyuch_oshibok.md' },
];

// The headings as a reader sees them in the PDF, to score what the parser kept.
const EXPECTED = {
  test1: ['Резюме', '1. Решение по базовой ставке', '2. Инфляция и её факторы', '2.1 Продовольственная инфляция', '2.2 Непродовольственная инфляция', '2.3 Платные услуги и регулируемые тарифы', '3. Инфляционные ожидания населения и бизнеса', '4. Внешние условия', '4.1 Мировые цены на нефть и сырьё', '4.2 Инфляция в странах — торговых партнёрах', '4.3 Валютный рынок и курс тенге', '5. Денежный рынок и кредитование', '5.1 Ставки денежного рынка', '5.2 Депозиты', '5.3 Кредитование экономики', '6. Бюджетная политика и квазифискальные операции', '7. Прогноз и риски', '7.1 Базовый сценарий', '7.2 Альтернативный сценарий', '7.3 Баланс рисков', '8. Дальнейшие решения по денежно-кредитной политике', 'Приложение. Основные показатели'],
  test2: ['Основные выводы', 'Банковский сектор: капитал и ликвидность', 'Качество кредитного портфеля', 'Потребительское кредитование и долговая нагрузка населения', 'Ипотека и рынок жилья', 'Кредитование малого и среднего бизнеса', 'Микрофинансовые организации и онлайн-кредитование', 'Стресс-тестирование банков', 'Меры макропруденциальной политики', 'Заключение'],
};

await main(async () => {
  const rows = [];
  for (const d of DOCS) {
    const t0 = Date.now();
    const parsed = await parseDocument(path.join(IN, d.file), d.file);
    const ms = Date.now() - t0;
    const text = parsed.text ?? '';
    fs.writeFileSync(path.join(OUT, `parsed-${d.file}.txt`), text, 'utf8');

    const lines = text.split('\n');
    const nonEmpty = lines.filter((l) => l.trim());
    const expected = EXPECTED[d.file.startsWith('test1') ? 'test1' : 'test2'];
    const lineSet = new Set(nonEmpty.map((l) => l.trim()));
    const headingsAsLines = expected.filter((h) => lineSet.has(h));
    const headingsAnywhere = expected.filter((h) => text.includes(h));

    const { text: cleaned, removedKinds } = cleanText(text);
    const found = findHeadings(cleaned);
    const split = splitSections(text);

    const key = parseKey(fs.readFileSync(path.join(IN, d.key), 'utf8'));
    const quotes = key.flatMap((k) => k.quotes);
    const verbatim = quotes.filter((q) => isVerbatimQuote(q, text));
    const brokenQuotes = quotes.filter((q) => !isVerbatimQuote(q, text));

    const row = {
      file: d.file, parseMs: ms, truncated: parsed.truncated, chars: text.length, pages: d.pages,
      charsPerPage: Math.round(text.length / d.pages),
      lines: lines.length, blankLines: lines.length - nonEmpty.length,
      runningLinesRemoved: removedKinds,
      hyphenJoined: (text.match(/денежнокредитн/g) || []).length,
      headingsExpected: expected.length, headingsAsOwnLine: headingsAsLines.length, headingsAnywhere: headingsAnywhere.length,
      headingsMissingAsLine: expected.filter((h) => !lineSet.has(h)),
      detector: { numbered: found.filter((h) => h.kind === 'numbered').length, unnumbered: found.filter((h) => h.kind === 'unnumbered').length, titles: found.map((h) => h.title) },
      falseHeadings: found.map((h) => h.title).filter((t) => !expected.includes(t)),
      missedHeadings: expected.filter((h) => !found.some((f) => f.title === h)),
      split: { method: split.method, raw: sizeStats(split.rawSections.map((s) => s.chars)), merged: sizeStats(split.sections.map((s) => s.text.length)), sections: split.sections.map((s) => ({ title: s.title, headings: s.headings, chars: s.text.length })) },
      keyQuotes: quotes.length, keyQuotesVerbatim: verbatim.length, keyQuotesBroken: brokenQuotes,
      cleanedChars: cleaned.length,
    };
    rows.push(row);
    console.log(`\n${d.file}: ${text.length} chars (${row.charsPerPage}/page), parse ${ms} ms, blank lines ${row.blankLines}, hyphen-joined ${row.hyphenJoined}`);
    console.log(`  headings: ${row.headingsAsOwnLine}/${row.headingsExpected} as own line; detector found ${found.length} (false ${row.falseHeadings.length}, missed ${row.missedHeadings.length})`);
    console.log(`  split: ${split.method}; raw ${JSON.stringify(row.split.raw)}; merged ${JSON.stringify(row.split.merged)}`);
    console.log(`  key quotes verbatim in extracted text: ${verbatim.length}/${quotes.length}`);
    if (row.falseHeadings.length) console.log(`  false: ${JSON.stringify(row.falseHeadings)}`);
    if (row.missedHeadings.length) console.log(`  missed: ${JSON.stringify(row.missedHeadings)}`);
  }
  save('04-parse.json', rows);
});
