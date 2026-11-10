// A1 stage 1, part A: the jargon dictionary on the real texts.
//
//   cd backend && npx tsx ../scripts/measure/14-jargon.ts
//
// 1. hits of every dictionary term in the five source documents (a term with
//    no hit anywhere is a candidate for removal);
// 2. density per section of test1 and test2, sections split exactly as the
//    product does (splitDocument), with the terms found — the check that the
//    word-form search works.
// The texts are what the product extracted (out/12-accept-*.json, out/parsed-*).

import fs from 'node:fs';
import path from 'node:path';
import { splitDocument } from '../../backend/src/services/documentSections';
import { findTerms, termDensity, wordCount } from '../../backend/src/services/jargon';
import { JARGON_DICTIONARY } from '../../backend/src/config/jargonDictionary';

const OUT = path.join(__dirname, 'out');
const fromRun = (f: string) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')).documentText as string;
const docs: Record<string, string> = {
  test1: fromRun('12-accept-test1-g3.json'),
  test2: fromRun('12-accept-test2-h1.json'),
  dkp_feb: fs.readFileSync(path.join(OUT, 'parsed-dkp_feb2026.pdf.txt'), 'utf8'),
  dkp_aug: fs.readFileSync(path.join(OUT, 'parsed-dkp_aug2026.pdf.txt'), 'utf8'),
  press: fromRun('12-accept-press-h1.json'),
};

const hits = JARGON_DICTIONARY.map((t) => {
  const row: Record<string, number> = {};
  for (const [name, text] of Object.entries(docs)) {
    row[name] = findTerms(text).find((h) => h.canonical === t.canonical)?.count ?? 0;
  }
  return { term: t.canonical, ...row, total: Object.values(row).reduce((a, b) => a + b, 0) };
});

const sections: Record<string, unknown[]> = {};
for (const name of ['test1', 'test2']) {
  sections[name] = splitDocument(docs[name]!).sections.map((s, i) => ({
    n: i + 1,
    heading: s.heading,
    words: wordCount(s.text),
    unique: findTerms(s.text).length,
    density: termDensity(s.text),
    terms: findTerms(s.text).map((h) => `${h.canonical}×${h.count}`),
  }));
}

const result = { dictionarySize: JARGON_DICTIONARY.length, hits, sections };
fs.writeFileSync(path.join(OUT, '14-jargon.json'), JSON.stringify(result, null, 2), 'utf8');

console.log(`dictionary: ${JARGON_DICTIONARY.length} terms; no hits anywhere: ${hits.filter((h) => h.total === 0).map((h) => h.term).join('; ') || 'none'}`);
console.log('term | test1 test2 feb aug press');
for (const h of hits) console.log(`${h.term} | ${h.test1} ${h.test2} ${h.dkp_feb} ${h.dkp_aug} ${h.press}`);
for (const [name, rows] of Object.entries(sections)) {
  console.log(`\n== ${name}`);
  for (const r of rows as { n: number; heading: string | null; words: number; unique: number; density: number; terms: string[] }[]) {
    console.log(`${r.n}. ${(r.heading ?? '(без заголовка)').slice(0, 60)} | ${r.words} сл. | ${r.unique} терм. | ${r.density}/1000 | ${r.terms.join(', ')}`);
  }
}
