// A candidate normaliser for isVerbatimQuote (services/promptSafety.ts), tested
// on every audit quote from step 5 (v1 and v2) — no model calls.
//
// What the failures turned out to be, read one by one: a hyphen left at a PDF
// line break ("денежно-\nкредитные" → "денежно- кредитные"), table cells that
// pdf-parse glues together ("6,47,58,67,1") and the model separates, a capital
// letter at the start of a mid-sentence quote, and "..." truncation. The
// candidate forgives exactly those and nothing else:
//
//   - all whitespace removed on both sides (covers line-break hyphens and glued
//     cells at once — deleting whitespace cannot turn a paraphrase into a match);
//   - lower case, ё→е, quote marks dropped, dashes unified;
//   - "..." / "…" splits the quote into pieces that must each occur, in order;
//   - edge punctuation trimmed.
//
// Inflection changes ("избыток" for "избытком") must still fail: that is a
// reworded quote, and accepting it is the line this check exists to hold.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OUT, save, main } from './lib.mjs';
import { splitSections } from './sections.mjs';
import { classifyQuote } from './quotes.mjs';

const require = createRequire('/app/package.json');
const { isVerbatimQuote } = require('/app/dist/services/promptSafety.js');
const { parseTruncatedJson } = require('/app/dist/services/llm.service.js');

const MIN_PIECE = 12;

function squash(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"""„']/g, '')
    .replace(/[—–‑]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^[.,;:!?…-]+|[.,;:!?…-]+$/g, '');
}

export function isVerbatimProposed(quote, documentText) {
  const doc = squash(documentText);
  const pieces = String(quote ?? '').split(/\.\.\.|…/).map(squash).filter((p) => p.length > 0);
  if (pieces.length === 0) return false;
  if (pieces.length > 1 && pieces.some((p) => p.length < MIN_PIECE)) return false;
  let from = 0;
  for (const p of pieces) {
    const at = doc.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

const FILES = { test1: 'test1_obzor_dkp', test2: 'test2_finstabilnost' };

await main(async () => {
  const out = {};
  for (const version of ['v1', 'v2']) {
    const tally = { total: 0, product: 0, proposed: 0, newlyAccepted: [], stillRejected: [] };
    for (const which of ['test1', 'test2']) {
      const raw = fs.readFileSync(path.join(OUT, `parsed-${FILES[which]}.pdf.txt`), 'utf8');
      const cleaned = splitSections(raw).cleanedText;
      for (const mode of ['map', 'reps', 'whole']) {
        const f = path.join(OUT, `05-${mode}-${which}${version === 'v1' ? '-v1' : ''}.json`);
        if (!fs.existsSync(f)) continue;
        for (const run of JSON.parse(fs.readFileSync(f, 'utf8'))) {
          const parsed = parseTruncatedJson(run.content.slice(Math.max(0, run.content.indexOf('{'))));
          for (const is of parsed?.issues ?? []) {
            const q = String(is?.quote ?? '');
            if (!q.trim()) continue;
            tally.total += 1;
            // The product checks against the raw stored text — so does this.
            const p = isVerbatimQuote(q, raw);
            const n = isVerbatimProposed(q, raw);
            if (p) tally.product += 1;
            if (n) tally.proposed += 1;
            if (n && !p) tally.newlyAccepted.push(q.slice(0, 160));
            if (!n) tally.stillRejected.push({ quote: q.slice(0, 160), group: classifyQuote(q, cleaned).group });
          }
        }
      }
    }
    out[version] = tally;
    console.log(`${version}: ${tally.total} quotes — product ${tally.product} (${Math.round((100 * tally.product) / tally.total)}%), proposed ${tally.proposed} (${Math.round((100 * tally.proposed) / tally.total)}%)`);
    for (const r of tally.stillRejected) console.log(`   still rejected (${r.group}): «${r.quote.replace(/\n/g, '⏎')}»`);
  }
  save('05-quotes-proposal.json', out);
});
