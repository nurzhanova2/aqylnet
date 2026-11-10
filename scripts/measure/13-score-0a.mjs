// Stage 0a scoring — no model calls, runs on the host.
//
//   node scripts/measure/13-score-0a.mjs test1|test2 [tag]
//
// Matches every finding of out/12-accept-<which>-<tag>.json to the key by
// where its quote sits in the document (same folding as the product's verbatim
// check: whitespace removed, case, ё, quote marks, dashes). A finding counts
// for a planted defect when one of its quotes overlaps a key quote within
// TOLERANCE folded characters; for a good fragment the same way. Absences have
// no quote and are listed with their checklist id for the manual read.
//
// This is the first pass. The verdict on each row is a manual read of the
// review file it writes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKey } from './keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const which = process.argv[2];
const tag = process.argv[3] || 'v1';
const TOLERANCE = 120;
const SRC = { test1: 'test1_obzor_dkp.pdf', test2: 'test2_finstabilnost.pdf' };

const fold = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"""„']/g, '')
  .replace(/[—–‑]/g, '-').replace(/\s+/g, '').replace(/^[.,;:!?…-]+|[.,;:!?…-]+$/g, '');

const run = JSON.parse(fs.readFileSync(path.join(HERE, 'out', `12-accept-${which}-${tag}.json`), 'utf8'));
const docRaw = run.documentText ?? fs.readFileSync(path.join(HERE, 'out', `parsed-${SRC[which]}.txt`), 'utf8');
const doc = fold(docRaw);

// The first piece of an elided quote is enough to place it.
function locate(q) {
  const piece = fold(String(q ?? '').split(/\.\.\.|…/)[0]);
  if (piece.length < 12) return null;
  const at = doc.indexOf(piece);
  return at < 0 ? null : { start: at, end: at + piece.length };
}

const key = parseKey(fs.readFileSync(path.join(HERE, 'in', `${which}_klyuch_oshibok.md`), 'utf8'));
const withSpans = (k) => ({ ...k, spans: k.quotes.map(locate).filter(Boolean) });
const defects = key.filter((k) => k.kind === 'defect').map(withSpans);
const goods = key.filter((k) => k.kind === 'good').map(withSpans);
const near = (a, b) => a.start <= b.end + TOLERANCE && a.end >= b.start - TOLERANCE;

const issues = run.report.analytics.issues ?? [];
const rows = issues.map((i) => {
  const locs = [locate(i.quote), locate(i.quote2)].filter(Boolean);
  const hit = (list) => list.filter((d) => d.spans.some((s) => locs.some((l) => near(l, s)))).map((d) => d.title);
  return {
    code: i.code, kind: i.kind ?? 'finding', severity: i.severity, category: i.category, section: i.section,
    title: i.title, quote: i.quote, quote2: i.quote2, checkId: i.checkId,
    quoteVerified: i.quoteVerified, quote2Verified: i.quote2Verified,
    defects: hit(defects), goods: hit(goods),
  };
});

const found = new Set(rows.flatMap((r) => r.defects));
console.log(`${which} ${tag}: ${issues.length} findings, overall ${run.report.analytics.overallScore}`);
console.log(`unlocated key quotes: ${[...defects, ...goods].filter((d) => d.spans.length < d.quotes.length).map((d) => d.title).join('; ') || 'none'}`);
for (const d of defects) console.log(`  ${found.has(d.title) ? '✔' : '·'} ${d.title}`);
const onGood = rows.filter((r) => r.goods.length);
console.log(`findings on good fragments: ${onGood.length}${onGood.map((r) => `\n  ${r.code} ${r.severity} → ${r.goods.join(', ')}: ${r.title}`).join('')}`);
console.log('checklist:');
for (const c of run.report.analytics.checklist ?? []) console.log(`  ${c.id}: ${c.answer}${c.section ? ` [${c.section}]` : ''}`);
console.log('critical / contradiction / absence / partial:');
for (const r of rows.filter((r) => r.severity === 'Critical' || r.kind !== 'finding')) {
  console.log(`  ${r.code} ${r.kind} ${r.severity} [${r.section ?? ''}] ${r.title}\n     «${(r.quote ?? '').slice(0, 140)}»${r.quote2 ? `\n     «${r.quote2.slice(0, 140)}»` : ''}  key: ${r.defects.join(', ') || '—'}`);
}

fs.writeFileSync(path.join(HERE, 'out', `13-review-${which}-${tag}.json`), JSON.stringify(rows, null, 2), 'utf8');
