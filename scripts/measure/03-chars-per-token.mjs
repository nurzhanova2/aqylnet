// Step 3: characters per token for the texts this product actually sees.
//
// Each sample is sent twice — whole and its first half — with max_tokens 1, and
// the ratio is taken from the *difference* in prompt_tokens. That cancels the
// chat-template overhead exactly instead of guessing it, which matters most for
// the short Kazakh sample, where twenty tokens of template would be 4% of the
// count.

import path from 'node:path';
import { chat, save, main, readUtf8, HERE } from './lib.mjs';
import { filler } from './filler.mjs';

const IN = path.join(HERE, 'in');
const SAMPLES = [
  { name: 'prose (doc-1117, НБК press release, PDF)', text: readUtf8(path.join(IN, 'doc-1117.txt')) },
  { name: 'tables & numbers (doc-1111, bank report, DOCX)', text: readUtf8(path.join(IN, 'doc-1111.txt')) },
  { name: 'kazakh (synthetic sample)', text: readUtf8(path.join(IN, 'kazakh-sample.txt')) },
  { name: 'needle filler (filler.mjs)', text: filler(30_000) },
];

async function promptTokens(text, label) {
  const r = await chat({
    messages: [{ role: 'user', content: text }],
    max_tokens: 1,
    chat_template_kwargs: { enable_thinking: false },
  }, { label, reserve: Math.ceil(text.length / 1.5) + 50 });
  if (r.status !== 200) throw new Error(`${label}: HTTP ${r.status} ${r.error}`);
  return r.prompt;
}

await main(async () => {
  const rows = [];
  for (const s of SAMPLES) {
    const half = s.text.slice(0, Math.floor(s.text.length / 2));
    const full = await promptTokens(s.text, `step3-full ${s.name}`);
    const part = await promptTokens(half, `step3-half ${s.name}`);
    const charsPerToken = (s.text.length - half.length) / (full - part);
    const overhead = full - s.text.length / charsPerToken;
    rows.push({ sample: s.name, chars: s.text.length, promptFull: full, promptHalf: part, charsPerToken: +charsPerToken.toFixed(3), templateOverhead: Math.round(overhead) });
    console.log(`${s.name}: ${s.text.length} chars → ${full} tokens; ${charsPerToken.toFixed(3)} chars/token, overhead ≈ ${Math.round(overhead)}`);
  }
  save('03-chars-per-token.json', rows);
});
