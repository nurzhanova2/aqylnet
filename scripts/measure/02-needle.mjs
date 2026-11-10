// Step 2: does the whole input reach the model?
//
// Three unique codes sit at the start, the middle and the end of a long Russian
// text; the model is asked to return all three. The instruction comes *after*
// the text, so it survives the failure this test exists to catch — silent
// truncation from the left, where the prompt arrives short, nothing errors, and
// the first code is simply gone.
//
// Sizes stop at 44k: vLLM reports max_model_len 49152 for prompt plus output,
// and the brief rules out probing above the window. Each size gets its own
// filler seed so a prefix cache cannot answer the bigger prompts from the
// smaller ones and make their latency look better than it is.
//
//   node 02-needle.mjs [targetTokens ...]     default: 8000 16000 32000 44000

import fs from 'node:fs';
import path from 'node:path';
import { chat, save, main, OUT } from './lib.mjs';
import { filler } from './filler.mjs';

const { overhead, rows } = JSON.parse(fs.readFileSync(path.join(OUT, '03b-chars-per-token.json'), 'utf8'));
const CPT = rows.find((r) => r.sample.startsWith('needle filler')).charsPerToken;

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const TARGETS = SIZES.length ? SIZES : [8_000, 16_000, 32_000, 44_000];

const WORDS = [['ЯНТАРЬ', 'БАРХАН', 'ЖАЙЛАУ'], ['КИПАРИС', 'МЕРИДИАН', 'САКСАУЛ'], ['ОРИГАМИ', 'ТЮЛЬПАН', 'ГОРИЗОНТ'], ['ЛАЗУРИТ', 'ПАРУСИНА', 'КАРАВАН']];
const INSTRUCTION = 'Выше приведён документ. В нём спрятаны ровно три контрольных кода вида КОД-СЛОВО-ЧИСЛО. ' +
  'Выпиши все найденные коды в порядке их появления в документе, каждый с новой строки, без пояснений. ' +
  'Если какой-то код найти не удалось, не выдумывай его.';

function build(target, i) {
  const words = WORDS[i % WORDS.length];
  const codes = words.map((w, k) => `КОД-${w}-${String(1000 + ((target / 1000) * 37 + k * 211) % 9000)}`);
  const fillerChars = Math.floor((target - overhead - 90) * CPT);
  const text = filler(fillerChars, 1000 + i);
  const at = [0.01, 0.5, 0.99].map((f) => text.indexOf('\n\n', Math.floor(text.length * f)));
  // Insert from the end so earlier offsets stay valid.
  let doc = text;
  for (let k = 2; k >= 0; k--) {
    const pos = at[k] < 0 ? doc.length : at[k];
    doc = `${doc.slice(0, pos)}\n\nКонтрольный код: ${codes[k]}.${doc.slice(pos)}`;
  }
  return { codes, doc, positions: at.map((p) => +(p / text.length).toFixed(3)) };
}

await main(async () => {
  const results = [];
  for (const [i, target] of TARGETS.entries()) {
    const { codes, doc, positions } = build(target, i);
    const expected = Math.round(overhead + (doc.length + INSTRUCTION.length) / CPT);
    const r = await chat({
      messages: [{ role: 'user', content: `${doc}\n\n${INSTRUCTION}` }],
      max_tokens: 120,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }, { label: `step2-needle-${target}`, reserve: Math.ceil(expected * 1.1) + 120 });

    const found = codes.map((c) => r.content.includes(c));
    const row = {
      target, chars: doc.length, positions, expectedPrompt: expected,
      status: r.status, error: r.error, promptTokens: r.prompt, completion: r.completion,
      promptVsExpected: r.prompt ? +(r.prompt / expected).toFixed(3) : null,
      found: { start: found[0], middle: found[1], end: found[2] },
      silentLeftTruncation: r.status === 200 && !found[0] && found[2],
      ms: r.ms, finish: r.finish, cached: r.cached, answer: r.content.trim(),
    };
    results.push(row);
    console.log(`${target}: HTTP ${r.status} ${r.ms}ms prompt=${r.prompt} (expected ~${expected}) found=${found.map((f) => (f ? '✔' : '✖')).join('')}${row.silentLeftTruncation ? '  ← SILENT LEFT TRUNCATION' : ''}`);
    if (r.status !== 200) console.log(`   error: ${r.error}`);
    save('02-needle.json', results);
    if (row.silentLeftTruncation) break; // a stop condition in the brief: report before spending more
  }
});
