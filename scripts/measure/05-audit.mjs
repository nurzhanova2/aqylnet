// Step 5: cost and stability of the audit — by section and on the whole document.
//
//   node 05-audit.mjs map   test1|test2   every section once (concurrency 4)
//   node 05-audit.mjs reps  test1|test2   two more runs of the section holding most key quotes
//   node 05-audit.mjs whole test1|test2   the whole document in one call
//
// Input is the PDF as the product extracts it (04-parse.mjs). The model gets
// the *cleaned* text — running headers removed, which A1 would do anyway — so
// that (a) and (b) differ only in how much document they see. Quotes are later
// checked against both the cleaned and the raw text, because the product
// verifies against the raw stored documentText, where a page footer sits in
// the middle of any sentence that crosses a page break.
//
// No transcript and no personas in either variant: the defects in the keys are
// properties of the document, and (c) — the transcript — is settled by
// calculation in 05c-calibrate.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { chat, save, main, OUT, spent, SOFT_CAP, StopError } from './lib.mjs';
import { buildAuditMessages, auditBody, judgeAudit } from './audit-prompt.mjs';
import { splitSections } from './sections.mjs';
import { parseKey } from './keys.mjs';
import { HERE } from './lib.mjs';
import { loose } from './quotes.mjs';

const [mode, which] = process.argv.slice(2);
const FILES = { test1: 'test1_obzor_dkp', test2: 'test2_finstabilnost' };
if (!['map', 'reps', 'whole'].includes(mode) || !FILES[which]) {
  console.log('usage: 05-audit.mjs map|reps|whole test1|test2');
  process.exit(1);
}
const MAX_TOKENS = 6144;

const raw = fs.readFileSync(path.join(OUT, `parsed-${FILES[which]}.pdf.txt`), 'utf8');
const split = splitSections(raw);
const doc = split.cleanedText;
const key = parseKey(fs.readFileSync(path.join(HERE, 'in', `${which}_klyuch_oshibok.md`), 'utf8'));

function reserveFor(chars) { return Math.ceil(chars / 2.6) + 1600 + MAX_TOKENS; }

async function audit(slice, label) {
  const messages = buildAuditMessages({ docSlice: slice, fullText: doc });
  const r = await chat(auditBody(messages, MAX_TOKENS), { label, reserve: reserveFor(slice.length) });
  const start = r.content.indexOf('{');
  let parsed = null;
  try { parsed = JSON.parse(r.content.slice(start)); } catch { /* judged below */ }
  return {
    label, status: r.status, error: r.error, ms: r.ms, prompt: r.prompt, completion: r.completion, finish: r.finish,
    contentChars: r.content.length, reasoningChars: r.reasoning.length,
    thinkingInContent: /thinking process|<think>/i.test(r.content),
    judge: judgeAudit(r.content, doc),
    content: r.content,
    parsedStrict: !!parsed,
  };
}

// loose(): PDF text breaks lines mid-sentence. The first version used a plain
// includes(), matched almost nothing, and picked the reps section blind.
function keyQuotesIn(text) {
  return key.flatMap((k) => k.quotes).filter((q) => loose(text).includes(loose(q))).length;
}

await main(async () => {
  const sections = split.sections.map((s, i) => ({ i, title: s.headings.join(' | ') || s.title, text: s.text, start: s.start }));
  let results = [];
  if (mode === 'map') {
    const need = sections.reduce((sum, s) => sum + reserveFor(s.text.length), 0);
    if (spent() + need > SOFT_CAP) throw new StopError(`budget: map of ${which} needs up to ${need}`);
    for (let k = 0; k < sections.length; k += 4) {
      const batch = sections.slice(k, k + 4);
      const rs = await Promise.all(batch.map((s) => audit(s.text, `step5a-map-${which}-s${s.i}`)));
      rs.forEach((r, j) => results.push({ section: batch[j].i, title: batch[j].title, chars: batch[j].text.length, keyQuotes: keyQuotesIn(batch[j].text), ...r }));
    }
  } else if (mode === 'reps') {
    const target = sections.reduce((best, s) => (keyQuotesIn(s.text) > keyQuotesIn(best.text) ? s : best));
    for (let rep = 2; rep <= 3; rep++) {
      const r = await audit(target.text, `step5a-rep${rep}-${which}-s${target.i}`);
      results.push({ section: target.i, title: target.title, chars: target.text.length, keyQuotes: keyQuotesIn(target.text), rep, ...r });
    }
  } else {
    const r = await audit(doc, `step5b-whole-${which}`);
    results.push({ section: 'whole', title: 'весь документ', chars: doc.length, keyQuotes: keyQuotesIn(doc), ...r });
  }
  for (const r of results) {
    console.log(`${r.label}: ${r.chars} chars, prompt ${r.prompt}, completion ${r.completion} (${r.finish}), ${r.ms} ms, strict=${r.parsedStrict} repaired=${r.judge.jsonRepaired}, issues ${r.judge.issues}, quotes ${r.judge.quotesVerbatim}/${r.judge.quotes}, thinking=${r.thinkingInContent}`);
  }
  save(`05-${mode}-${which}.json`, results);
});
