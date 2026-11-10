// Step 1: what actually stands behind the alias.
//
// Asks every LiteLLM endpoint that could say it (most need an admin key and
// will refuse — the refusal is recorded too), then makes one tiny completion
// to read the `model` field and the provider headers LiteLLM forwards from the
// runtime behind it.

import { get, chat, save, main, MODEL } from './lib.mjs';

const ENDPOINTS = ['/v1/models', '/v1/models/' + encodeURIComponent(MODEL), '/model/info', '/v1/model/info', '/model_group/info', '/key/info'];

// /key/info describes the caller's own key; the key value itself must never be
// printed, so anything that looks like it is dropped before saving.
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(key|token|api_key|key_name|key_alias|user_id|team_id|token_id|hashed|email|issuer_sub|issuance_request_id|created_by|updated_by)/i.test(k)) { o[k] = '<redacted>'; continue; }
      o[k] = typeof x === 'string' && /@/.test(x) ? '<redacted>' : scrub(x);
    }
    return o;
  }
  return v;
}

await main(async () => {
  const endpoints = {};
  for (const p of ENDPOINTS) {
    const r = await get(p);
    endpoints[p] = { status: r.status, error: r.error, body: r.json ? scrub(r.json) : r.text.slice(0, 500) };
    console.log(`${p}: HTTP ${r.status}`);
  }

  const c = await chat({
    messages: [{ role: 'user', content: 'Назови своё точное имя модели и версию одной строкой.' }],
    max_tokens: 200,
  }, { label: 'step1-whoami', reserve: 400 });
  console.log(`chat: HTTP ${c.status}, model=${c.model}, finish=${c.finish}, prompt=${c.prompt}, completion=${c.completion}`);
  console.log(`headers: ${JSON.stringify(c.headers)}`);
  console.log(`self-report: ${c.content.trim().slice(0, 200)}`);

  save('01-model-info.json', { endpoints, chat: c });
});
