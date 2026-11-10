// Step 5, variant (c) by calculation: how many tokens a transcript costs inside
// the audit prompt, and how many the prompt's own scaffolding costs.
//
// Two max_tokens=1 calls on the copied audit prompt with the same document and
// the same eight personas, without and with the largest real transcript in the
// database (project 1120: 45 messages, 26 593 characters). The difference is the
// transcript's exact token cost as the product formats it ("Имя: текст" lines
// inside the fence), which is what the window calculation needs — not the
// chars/token of loose prose from step 3.

import path from 'node:path';
import fs from 'node:fs';
import { chat, save, main, readUtf8, HERE } from './lib.mjs';
import { buildAuditMessages, auditBody, transcriptWithinBudget } from './audit-prompt.mjs';

const doc = readUtf8(path.join(HERE, 'in', 'doc-1117.txt'));
const { messages: timeline, personas } = JSON.parse(readUtf8(path.join(HERE, 'in', 'transcript-1120.json')));

async function promptTokens(withTranscript, label) {
  const msgs = buildAuditMessages({ docSlice: doc, fullText: doc, personas, timeline: withTranscript ? timeline : [] });
  const r = await chat(auditBody(msgs, 1), { label, reserve: 14_000 });
  return { prompt: r.prompt, chars: msgs.reduce((s, m) => s + m.content.length, 0) };
}

await main(async () => {
  const without = await promptTokens(false, 'step5c-no-transcript');
  const withT = await promptTokens(true, 'step5c-transcript-1120');
  const transcriptChars = transcriptWithinBudget(timeline).length;
  const transcriptTokens = withT.prompt - without.prompt;
  const docTokens = Math.round(doc.length / JSON.parse(fs.readFileSync(path.join(process.env.MEASURE_OUT, '03b-chars-per-token.json'), 'utf8')).rows[0].charsPerToken);
  const out = {
    documentChars: doc.length,
    promptWithoutTranscript: without.prompt,
    promptWithTranscript: withT.prompt,
    transcriptChars,
    transcriptTokens,
    transcriptCharsPerToken: +(transcriptChars / transcriptTokens).toFixed(3),
    scaffoldTokens: without.prompt - docTokens,
    note: 'scaffold = system message + fences + JSON spec + 8 personas + jurisdiction grounding, i.e. everything except document and transcript',
  };
  console.log(out);
  save('05c-calibrate.json', out);
});
