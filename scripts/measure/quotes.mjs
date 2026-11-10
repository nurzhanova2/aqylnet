// Why does a quote fail isVerbatimQuote? Sorts each failure into the three
// groups asked for:
//
//   (a) cosmetic — passes once ё/е, quote marks, case, spacing, edge
//       punctuation and ellipsis-truncation are forgiven. A normaliser in
//       reportTrust.ts could accept these without accepting anything invented.
//   (b) paraphrase — a long run of the quote's words does occur in the
//       document, but the quote as a whole was reworded.
//   (c) absent — no meaningful run of it is in the document at all.
//
// The thresholds are deliberately strict for (a) and loose for (b): (a) is the
// group that would justify a code change, so it must not absorb paraphrases.

import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const { isVerbatimQuote } = require('/app/dist/services/promptSafety.js');

export function loose(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"""„'`]/g, '')
    .replace(/[—–‑-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?…-]+|[\s.,;:!?…-]+$/g, '');
}

/** Longest run of consecutive quote words that occurs in the document, as a share of the quote. */
function longestRun(q, docLoose) {
  const w = q.split(' ');
  let best = 0;
  let bestText = '';
  for (let i = 0; i < w.length; i++) {
    for (let j = w.length; j > i + best; j--) {
      const s = w.slice(i, j).join(' ');
      if (docLoose.includes(s)) { best = j - i; bestText = s; break; }
    }
  }
  return { share: w.length ? best / w.length : 0, words: best, of: w.length, text: bestText };
}

export function classifyQuote(quote, documentText) {
  if (!String(quote ?? '').trim()) return { group: 'empty' };
  if (isVerbatimQuote(quote, documentText)) return { group: 'verbatim' };
  const docL = loose(documentText);
  const q = loose(quote);
  if (docL.includes(q)) return { group: 'a', why: whyCosmetic(quote, documentText) };
  // Truncation marked with an ellipsis: every piece must be verbatim (loosely).
  const parts = String(quote).split(/\.\.\.|…/).map(loose).filter((p) => p.length >= 12);
  if (parts.length > 1 && parts.every((p) => docL.includes(p))) return { group: 'a', why: 'ellipsis' };
  const run = longestRun(q, docL);
  if (run.share >= 0.5 && run.words >= 5) return { group: 'b', run };
  return { group: 'c', run };
}

function whyCosmetic(quote, doc) {
  const reasons = [];
  if (/ё/i.test(doc + quote) && loose(quote) !== loose(quote.replace(/ё/g, 'е'))) reasons.push('ё/е');
  if (/[«»"""„]/.test(quote)) reasons.push('quotes');
  if (quote !== quote.trim() || /[.,;:…]$/.test(quote.trim())) reasons.push('edge punctuation');
  if (doc.toLowerCase().includes(quote.toLowerCase()) === false) reasons.push('case/ё/spacing');
  return reasons.join(', ') || 'normalisation';
}

/** Where a quote sits in the document (loose match), for matching against the key. */
export function locate(quote, documentText) {
  const docL = loose(documentText);
  const q = loose(quote);
  if (!q) return null;
  let at = docL.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length, exact: true };
  const run = longestRun(q, docL);
  if (run.words >= 5) {
    at = docL.indexOf(run.text);
    return { start: at, end: at + run.text.length, exact: false };
  }
  return null;
}
