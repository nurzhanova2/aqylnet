// Step 3, second pass: measures the chat-template overhead directly and
// recomputes chars/token from the counts 03-chars-per-token.mjs already saved.
//
// The half-vs-whole slope in 03 assumed a document is equally dense throughout.
// Real ones are not — the bank report turns into tables in its second half —
// so the slope gave negative overheads. Whole length over (prompt − overhead),
// with the overhead taken from a one-character message, has no such assumption.

import fs from 'node:fs';
import path from 'node:path';
import { chat, save, main, OUT } from './lib.mjs';

await main(async () => {
  const r = await chat({
    messages: [{ role: 'user', content: 'а' }],
    max_tokens: 1,
    chat_template_kwargs: { enable_thinking: false },
  }, { label: 'step3-overhead', reserve: 50 });
  // One Cyrillic letter is one token in this vocabulary; everything else is template.
  const overhead = r.prompt - 1;
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, '03-chars-per-token.json'), 'utf8'));
  const out = rows.map((x) => ({
    sample: x.sample,
    chars: x.chars,
    promptTokens: x.promptFull,
    textTokens: x.promptFull - overhead,
    charsPerToken: +(x.chars / (x.promptFull - overhead)).toFixed(3),
  }));
  for (const x of out) console.log(`${x.sample}: ${x.chars} chars / ${x.textTokens} tokens = ${x.charsPerToken}`);
  console.log(`template overhead: ${overhead} tokens (prompt_tokens for "а" = ${r.prompt})`);
  save('03b-chars-per-token.json', { overhead, rows: out });
});
