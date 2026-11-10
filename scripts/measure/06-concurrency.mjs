// Step 6: does the runtime serve requests in parallel, or one after another?
//
// The same section-sized audit call (the copied generateDocumentAudit prompt on
// a 6.5k-character НБК press release, no transcript) at concurrency 1, 2 and 4.
// If wall time grows linearly with concurrency, the GPU is effectively serial
// and the ceiling of the whole system is time, not tokens.
//
// Completion lengths differ between runs, so wall time alone can mislead;
// decode throughput (completion tokens per second, per request and summed) is
// the number that answers the question.
//
// Caveat recorded in the report: the GPU is shared with every other user of the
// proxy, so a single run is a sample of a noisy system, not a benchmark.
//
//   node 06-concurrency.mjs [levels...]    default: 1 2 4

import path from 'node:path';
import { chat, save, main, readUtf8, HERE, spent, SOFT_CAP, StopError } from './lib.mjs';
import { buildAuditMessages, auditBody, judgeAudit } from './audit-prompt.mjs';

const LEVELS = process.argv.slice(2).map(Number).filter(Boolean);
const CONCURRENCY = LEVELS.length ? LEVELS : [1, 2, 4];
const MAX_TOKENS = 6144;

const doc = readUtf8(path.join(HERE, 'in', 'doc-1117.txt'));
const RESERVE = Math.ceil(doc.length / 2.6) + 1500 + MAX_TOKENS;

function oneCall(label) {
  const messages = buildAuditMessages({ docSlice: doc, fullText: doc });
  return chat(auditBody(messages, MAX_TOKENS), { label, reserve: RESERVE });
}

await main(async () => {
  const batches = [];
  for (const n of CONCURRENCY) {
    if (spent() + n * RESERVE > SOFT_CAP) throw new StopError(`budget: batch of ${n} would cross the soft cap`);
    const started = Date.now();
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => oneCall(`step6-c${n}-${i + 1}`)));
    const wall = Date.now() - started;
    const calls = rs.map((r) => ({
      status: r.status, ms: r.ms, prompt: r.prompt, completion: r.completion, finish: r.finish,
      tokPerSec: +(r.completion / (r.ms / 1000)).toFixed(1),
      contentChars: r.content.length, reasoningChars: r.reasoning.length,
      ...judgeAudit(r.content, doc),
    }));
    const completionSum = calls.reduce((s, c) => s + c.completion, 0);
    const batch = { concurrency: n, wallMs: wall, completionSum, aggregateTokPerSec: +(completionSum / (wall / 1000)).toFixed(1), calls };
    batches.push(batch);
    console.log(`c=${n}: wall ${wall} ms, Σcompletion ${completionSum}, aggregate ${batch.aggregateTokPerSec} tok/s`);
    for (const c of calls) console.log(`   ${c.ms} ms, prompt ${c.prompt}, completion ${c.completion} (${c.finish}), ${c.tokPerSec} tok/s, json strict=${c.jsonStrict} repaired=${c.jsonRepaired}, issues ${c.issues}, quotes ${c.quotesVerbatim}/${c.quotes}`);
    save('06-concurrency.json', batches);
  }
});
