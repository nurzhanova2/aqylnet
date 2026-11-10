// Step 5 scoring — no model calls. Reads the 05-*.json results and:
//
//   1. matches each audit issue to the planted defects of the key, by where its
//      quote sits in the document: an issue counts for a defect when its quote
//      overlaps (±TOLERANCE characters) one of that defect's key quotes;
//   2. sorts every non-verbatim quote into (a) cosmetic / (b) paraphrase /
//      (c) absent — see quotes.mjs;
//   3. writes every issue to 05-review.json, so the automatic match and the
//      "beyond the key — real or invented?" question can be checked by reading.
//
// The location match is a first pass, not the verdict. Issues without a quote,
// and defects whose key quote is a whole paragraph away from where the problem
// shows, need the manual read the report records.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OUT, HERE, save, main } from './lib.mjs';
import { splitSections } from './sections.mjs';
import { parseKey } from './keys.mjs';
import { classifyQuote, locate, loose } from './quotes.mjs';

const require = createRequire('/app/package.json');
const { parseTruncatedJson } = require('/app/dist/services/llm.service.js');

const TOLERANCE = 150;
const FILES = { test1: 'test1_obzor_dkp', test2: 'test2_finstabilnost' };

function load(name) {
  const f = path.join(OUT, name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}

await main(async () => {
  const summary = {};
  const review = [];
  const quoteGroups = { verbatim: 0, a: 0, b: 0, c: 0, empty: 0 };
  const quoteGroupsRaw = { verbatim: 0, a: 0, b: 0, c: 0, empty: 0 };
  const failures = [];

  for (const which of ['test1', 'test2']) {
    const raw = fs.readFileSync(path.join(OUT, `parsed-${FILES[which]}.pdf.txt`), 'utf8');
    const doc = splitSections(raw).cleanedText;
    const key = parseKey(fs.readFileSync(path.join(HERE, 'in', `${which}_klyuch_oshibok.md`), 'utf8'));
    const defects = key.filter((k) => k.kind === 'defect').map((k) => ({ ...k, spans: k.quotes.map((q) => locate(q, doc)).filter(Boolean) }));

    const runs = [
      ...load(`05-map-${which}.json`).map((r) => ({ ...r, variant: 'map' })),
      ...load(`05-reps-${which}.json`).map((r) => ({ ...r, variant: 'rep' })),
      ...load(`05-whole-${which}.json`).map((r) => ({ ...r, variant: 'whole' })),
    ];

    const found = { map: new Set(), whole: new Set() };
    const repSection = load(`05-reps-${which}.json`)[0]?.section;
    const repFound = [];

    for (const run of runs) {
      const body = run.content.slice(Math.max(0, run.content.indexOf('{')));
      const parsed = parseTruncatedJson(body);
      const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
      const hits = new Set();
      for (const [n, is] of issues.entries()) {
        const quote = String(is?.quote ?? '');
        const cls = classifyQuote(quote, doc);
        const clsRaw = classifyQuote(quote, raw);
        quoteGroups[cls.group] += 1;
        quoteGroupsRaw[clsRaw.group] += 1;
        if (!['verbatim', 'empty'].includes(cls.group)) failures.push({ which, run: run.label, quote, group: cls.group, why: cls.why, run_: cls.run });
        const loc = locate(quote, doc);
        const matched = loc
          ? defects.filter((d) => d.spans.some((s) => loc.start <= s.end + TOLERANCE && loc.end >= s.start - TOLERANCE)).map((d) => d.title)
          : [];
        matched.forEach((m) => hits.add(m));
        review.push({ which, run: run.label, variant: run.variant, section: run.section, n: n + 1, severity: is?.severity, category: is?.category, title: is?.title, quote, quoteGroup: cls.group, quoteGroupVsRaw: clsRaw.group, autoMatch: matched });
      }
      if (run.variant === 'map') hits.forEach((h) => found.map.add(h));
      if (run.variant === 'whole') hits.forEach((h) => found.whole.add(h));
      if (run.section === repSection && run.variant !== 'whole') repFound.push([...hits]);
    }

    summary[which] = {
      defects: defects.length,
      foundByMap: [...found.map],
      foundByWhole: [...found.whole],
      repSection,
      defectsInRepSection: (() => {
        const sec = splitSections(raw).sections[repSection];
        // loose(): PDF text breaks lines mid-sentence, so a plain includes() misses
        // nearly every key quote — the bug that made 05-audit pick its rep section blind.
        return sec ? defects.filter((d) => d.quotes.some((q) => loose(sec.text).includes(loose(q)))).map((d) => d.title) : [];
      })(),
      repRuns: repFound,
    };
    console.log(`\n${which}: ${defects.length} planted defects`);
    console.log(`  map (all sections, 1 run): ${found.map.size} — ${[...found.map].join('; ')}`);
    console.log(`  whole (1 call):            ${found.whole.size} — ${[...found.whole].join('; ')}`);
    console.log(`  section ${repSection}, 3 runs: ${repFound.map((h) => h.length + ' [' + h.join('; ') + ']').join(' | ')}`);
  }

  console.log(`\nquotes vs cleaned text: ${JSON.stringify(quoteGroups)}`);
  console.log(`quotes vs raw text (what the product checks): ${JSON.stringify(quoteGroupsRaw)}`);
  save('05-review.json', review);
  save('05-score.json', { summary, quoteGroups, quoteGroupsRaw, failures });
});
