// Step 7: is there a prefix cache, and what does it buy?
//
// Two pairs: a cold call on a fresh ~12k-token prefix, then the same prefix
// with a different question at the end. max_tokens 1, so latency is almost
// pure prefill. vLLM does not report cached_tokens here (see step 2), so the
// latency difference is the only evidence — and the prompt_tokens it bills are
// recorded to show whether a cache hit is cheaper in *tokens* at all.

import path from 'node:path';
import { chat, save, main, readUtf8, HERE } from './lib.mjs';
import { filler } from './filler.mjs';

const real = readUtf8(path.join(HERE, 'in', 'doc-1111.txt')) + '\n\n' + readUtf8(path.join(HERE, 'in', 'doc-1117.txt'));
const TAILS = ['Какие три главных риска для заёмщиков следуют из этого документа?', 'Какие формулировки этого документа будут непонятны пенсионеру?'];

function prefix(seed) {
  // Real text first so the prefix looks like a document, then filler to ~12k tokens.
  return `${real}\n\n${filler(24_000, seed)}`;
}

async function call(p, tail, label) {
  return chat({
    messages: [{ role: 'user', content: `${p}\n\n${tail}` }],
    max_tokens: 1,
    chat_template_kwargs: { enable_thinking: false },
  }, { label, reserve: Math.ceil(p.length / 2.5) + 100 });
}

await main(async () => {
  const rows = [];
  for (const seed of [7001, 7002]) {
    const p = prefix(seed);
    for (const [k, tail] of TAILS.entries()) {
      const r = await call(p, tail, `step7-seed${seed}-${k ? 'warm' : 'cold'}`);
      rows.push({ seed, kind: k ? 'warm' : 'cold', ms: r.ms, prompt: r.prompt, cached: r.cached, usage: r.usageRaw });
      console.log(`seed ${seed} ${k ? 'warm' : 'cold'}: ${r.ms} ms, prompt ${r.prompt}, cached ${r.cached}`);
    }
  }
  save('07-prefix-cache.json', rows);
});
