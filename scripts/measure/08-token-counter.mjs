// Can the product count tokens exactly before sending, instead of guessing from
// characters? LiteLLM exposes /utils/token_counter, which runs no model and
// costs no quota — but it may silently fall back to an OpenAI tokenizer for a
// model it does not recognise, which would be worse than a ratio.
//
// Checked against counts the model itself reported in step 3: the prose sample
// (doc-1117) is 2 072 text tokens, the Kazakh sample 537.

import path from 'node:path';
import https from 'node:https';
import { save, main, readUtf8, HERE, BASE, MODEL } from './lib.mjs';

const KEY = process.env.LLM_API_KEY || '';

function post(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve) => {
    const req = https.request(new URL(BASE + '/utils/token_counter'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length },
      timeout: 30_000,
    }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => { const t = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j, text: t.slice(0, 300) }); });
    });
    req.on('error', (e) => resolve({ status: 0, text: e.message }));
    req.write(payload);
    req.end();
  });
}

await main(async () => {
  const samples = [
    { name: 'prose doc-1117', text: readUtf8(path.join(HERE, 'in', 'doc-1117.txt')), measured: 2072 },
    { name: 'kazakh sample', text: readUtf8(path.join(HERE, 'in', 'kazakh-sample.txt')), measured: 537 },
  ];
  const rows = [];
  for (const s of samples) {
    const r = await post({ model: MODEL, prompt: s.text });
    const counted = r.json?.total_tokens ?? null;
    rows.push({ sample: s.name, status: r.status, counted, measuredByModel: s.measured, tokenizer: r.json?.tokenizer_type ?? null, modelUsed: r.json?.model_used ?? null, error: r.status !== 200 ? r.text : undefined });
    console.log(`${s.name}: HTTP ${r.status}, counted ${counted} vs model ${s.measured}, tokenizer ${r.json?.tokenizer_type}, model_used ${r.json?.model_used}`);
  }
  save('08-token-counter.json', rows);
});
