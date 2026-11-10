// Real NBK documents through the product's own code (compiled dist in the
// container): parseDocument → the window check → splitDocument. No model calls.
//
//   node 11-real-docs.mjs file.pdf:pages [file.pdf:pages ...]
//
// For each document: size, whether a project would accept it, and the sections
// the splitter produces — with the two things the product owner asked about
// flagged explicitly: captions ("График 1.1", "Бокс 2", "Таблица 3") must never
// start a section, roman chapters I–VII must.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { save, main, HERE, OUT } from './lib.mjs';

const require = createRequire('/app/package.json');
const { parseDocument } = require('/app/dist/services/documentParser.js');
const { splitDocument, findHeadings } = require('/app/dist/services/documentSections.js');
const { assertDocumentFitsWindow, maxDocumentChars } = require('/app/dist/services/promptBudget.js');

const CAPTION = /^(?:\d+(?:\.\d+)*\.?\s+)?(график|графики|рисунок|таблица|бокс|врезка|диаграмма|схема|источник|примечание|справочно)/iu;
const ROMAN = /^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\.\s/;

await main(async () => {
  const rows = [];
  for (const arg of process.argv.slice(2)) {
    const [file, pages] = arg.split(':');
    const parsed = await parseDocument(path.join(HERE, 'in', file), file);
    const text = parsed.text ?? '';
    fs.writeFileSync(path.join(OUT, `parsed-${file}.txt`), text, 'utf8');

    let fits = true;
    let refusal = null;
    try { assertDocumentFitsWindow(text); } catch (e) { fits = false; refusal = e.message; }

    const { method, sections } = splitDocument(text);
    const headings = findHeadings(text).map((h) => h.title);
    const sectionHeads = sections.flatMap((s) => (s.heading ?? '').split(' / ').filter(Boolean));
    const invariant = sections.length > 0 && sections[0].startOffset === 0 &&
      sections[sections.length - 1].endOffset === text.length &&
      sections.every((s, i) => text.slice(s.startOffset, s.endOffset) === s.text && (i === 0 || sections[i - 1].endOffset === s.startOffset));

    // Every line in the text that looks like a caption or a roman chapter —
    // the ground truth to compare the section headings against.
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const captionLines = lines.filter((l) => CAPTION.test(l) && l.length < 160);
    const romanLines = lines.filter((l) => ROMAN.test(l));

    // The document's own table of contents is the ground truth for headings:
    // every entry (boxes excepted — they must not become sections) should be
    // found as a heading, page number stripped.
    const tocEntries = lines.slice(0, 120)
      .filter((l) => /^(РЕШЕНИЕ|[IVX]+\.|\d+(?:\.\d+)*\.)\s.*\s\d{1,3}$/.test(l))
      .map((l) => l.replace(/\s+\d{1,3}$/, '').replace(/\s+/g, ' ').trim());
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const headSet = new Set(headings.map(norm));
    const tocMissed = tocEntries.filter((t) => !headSet.has(t));

    const row = {
      tocEntries: tocEntries.length, tocMissed,
      file, pages: Number(pages), chars: text.length, charsPerPage: Math.round(text.length / Number(pages)),
      truncated: parsed.truncated, limitChars: maxDocumentChars(), fits, refusal,
      method, sections: sections.map((s) => ({ order: s.order, chars: s.text.length, heading: s.heading })),
      headingsFound: headings,
      captionsAsSectionHeads: sectionHeads.filter((h) => CAPTION.test(h)),
      romanLines, romanAsSectionHeads: sectionHeads.filter((h) => ROMAN.test(h)),
      captionLinesInText: captionLines.length,
      invariant,
    };
    rows.push(row);
    console.log(`\n${file}: ${text.length} chars, ${pages} pages (${row.charsPerPage}/page), limit ${row.limitChars}, fits=${fits}`);
    if (refusal) console.log(`  refusal: ${refusal}`);
    console.log(`  split: ${method}, ${sections.length} sections, invariant ${invariant ? 'OK' : 'BROKEN'}`);
    console.log(`  table of contents: ${tocEntries.length - tocMissed.length}/${tocEntries.length} entries found as headings${tocMissed.length ? ` — missed ${JSON.stringify(tocMissed)}` : ''}`);
    console.log(`  roman lines in text: ${JSON.stringify(romanLines)}`);
    console.log(`  roman as section heads: ${JSON.stringify(row.romanAsSectionHeads)}`);
    console.log(`  caption-like lines in text: ${captionLines.length}; as section heads: ${JSON.stringify(row.captionsAsSectionHeads)}`);
    for (const s of sections) console.log(`   ${String(s.order).padStart(2)} ${String(s.text.length).padStart(6)}  ${s.heading ?? '(без заголовка)'}`);
  }
  save('11-real-docs.json', rows);
});
