#!/usr/bin/env node
// Verifies a LiteLLM token + model pair before trusting it with the product.
//
// Written because the switch from Qwen/Qwen3.5-35B-A3B-FP8 to assistant-balanced
// could not be tested in advance: the old key is scoped to one model and answers
// 403 `key_model_access_denied` for any other name, so the new model's reasoning
// cost, and whether it accepts the vLLM thinking passthrough, were unknowable.
// This script answers both in one run, against the budgets the code actually
// uses.
//
// Run it inside the backend container, which trusts the intercepting proxy root
// (curl on a Windows host does not — it uses its own CA bundle, not the Windows
// store, and fails with an SSL error before reaching the proxy):
//
//   docker compose cp scripts/check-llm-model.mjs backend:/tmp/check.mjs
//   docker compose exec backend node /tmp/check.mjs
//
// Or from the host with the certificate named explicitly (after `npm run build`
// in backend/, so backend/dist exists):
//
//   NODE_EXTRA_CA_CERTS=backend/certs/infowatch-proxy-root.crt \
//     LLM_API_KEY=... LLM_MODEL=assistant-balanced node scripts/check-llm-model.mjs

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// The budgets come from the backend's own compiled config, not from literals
// here: a copy kept in this script once covered 7 of the 17 budgets and drifted
// as stages were added. Same resolution as the backend — limits.ts defaults,
// overridden by the same LLM_MAX_TOKENS_* variables.
const ENV_JS_CANDIDATES = [
  '/app/dist/config/env.js',                                                   // in the container
  fileURLToPath(new URL('../backend/dist/config/env.js', import.meta.url)),   // from the host
];
const envJs = ENV_JS_CANDIDATES.find((p) => existsSync(p));
if (!envJs) {
  console.log(`  ✖ backend config not found (looked in: ${ENV_JS_CANDIDATES.join(', ')}).`);
  console.log('     Run inside the backend container, or `npm run build` in backend/ first.');
  process.exit(1);
}
let env;
try {
  ({ env } = require(envJs));
} catch (e) {
  console.log(`  ✖ could not load ${envJs}: ${e.message}`);
  process.exit(1);
}

const BASE = env.llmApiBase.replace(/\/$/, '');
const KEY = env.llmApiKey;
const MODEL = env.llmModel;
const BUDGETS = env.llm.maxTokens;

// The two free-text budgets are the ones that can break on a reasoning model.
// They are small on purpose — this model treats max_tokens as a target length,
// so raising them would quadruple transcripts — which leaves them the least
// room for reasoning. If either returns an empty answer, raise just that one.
const FREE_TEXT = ['personaResponse', 'moderatorMessage'];

// Which variable raises which budget — names only, the values come from env.js.
const ENV_VAR = {
  suggestPersonas: 'LLM_MAX_TOKENS_SUGGEST',
  personaPositions: 'LLM_MAX_TOKENS_POSITIONS',
  personaResponse: 'LLM_MAX_TOKENS_PERSONA',
  moderatorMessage: 'LLM_MAX_TOKENS_MODERATOR',
  discussionReport: 'LLM_MAX_TOKENS_REPORT',
  auditSection: 'LLM_MAX_TOKENS_AUDIT',
  auditAlignment: 'LLM_MAX_TOKENS_ALIGNMENT',
  auditChecklist: 'LLM_MAX_TOKENS_CHECKLIST',
  auditContradictions: 'LLM_MAX_TOKENS_CONTRADICTIONS',
  personaScore: 'LLM_MAX_TOKENS_PERSONA_SCORE',
  decisionReference: 'LLM_MAX_TOKENS_DECISION_REFERENCE',
  decisionVerdicts: 'LLM_MAX_TOKENS_DECISION_VERDICTS',
  missingExplanations: 'LLM_MAX_TOKENS_MISSING',
  rewriteCard: 'LLM_MAX_TOKENS_REWRITE_CARD',
  rewriteBrief: 'LLM_MAX_TOKENS_REWRITE_BRIEF',
  rewriteBluf: 'LLM_MAX_TOKENS_REWRITE_BLUF',
  rewriteSection: 'LLM_MAX_TOKENS_REWRITE_SECTION',
};

// A scenario added to env.ts without a line above would otherwise be checked
// with no advice on which variable to raise.
const unnamed = Object.keys(BUDGETS).filter((k) => !ENV_VAR[k]);
if (unnamed.length > 0) {
  console.log(`  ✖ budgets without an env variable name in this script: ${unnamed.join(', ')}`);
  process.exit(1);
}

// vLLM here runs without a reasoning parser, so when the thinking switch does
// not reach it the reasoning arrives *inside* content, under this heading —
// measured 03.11. The product sends the switch as a top-level body key, the way
// every call below does.
const THINKING_LEAK = /thinking process|<think>/i;

// Checks 3 and 4 used to send no switch at all, i.e. with reasoning on — which
// is how this script once "measured" the audit spending 5953 of 6144 tokens on
// 62 characters, a figure the product never produced. They now send what the
// product sends.
const AS_PRODUCT = env.llm.disableThinking
  ? { chat_template_kwargs: { enable_thinking: false } }
  : {};

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  ✖ ${msg}`); };
const pass = (msg) => console.log(`  ✔ ${msg}`);

async function call(body) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, ...body }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, ms: Date.now() - started, json, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, error: e.cause?.code || e.message };
  }
}

function inspect(r) {
  const choice = r.json?.choices?.[0];
  const message = choice?.message ?? {};
  const usage = r.json?.usage ?? {};
  return {
    content: (message.content ?? '').trim(),
    reasoning: (message.reasoning_content ?? message.reasoning ?? '').trim(),
    finish: choice?.finish_reason ?? '-',
    prompt: usage.prompt_tokens ?? 0,
    completion: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
  };
}

const ASK = { messages: [{ role: 'user', content: 'Ответь одним коротким предложением: что такое инфляция?' }] };

console.log(`base:  ${BASE}`);
console.log(`model: ${MODEL}`);
console.log(`key:   ${KEY ? `set (${KEY.length} chars)` : 'MISSING'}`);
console.log(`budgets: ${Object.keys(BUDGETS).length} from ${envJs}\n`);

if (!KEY) {
  console.log('  ✖ LLM_API_KEY is empty — nothing to check.');
  process.exit(1);
}

// Everything after check 1 assumes the model answers at all. Without this the
// later checks repeat the same 403 and hand out advice about the wrong knob —
// "set LLM_DISABLE_THINKING=false" when the real problem is the model name.
let reachable = false;

console.log('1. Is the model reachable with this key?');
{
  const r = await call({ ...ASK, max_tokens: BUDGETS.moderatorMessage });
  if (r.status === 0) fail(`transport error: ${r.error}`);
  else if (r.status === 403) {
    fail(`403 ${r.json?.error?.type ?? ''} — ${r.json?.error?.message ?? r.text.slice(0, 200)}`);
    console.log('     The key is scoped to a different model. Set LLM_MODEL to a name this key allows.');
  } else if (r.status !== 200) fail(`HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  else {
    const i = inspect(r);
    pass(`HTTP 200 in ${r.ms}ms, finish=${i.finish}, prompt=${i.prompt}, completion=${i.completion}`);
    if (i.content) pass(`answer present (${i.content.length} chars)`);
    else fail('HTTP 200 but the final content is EMPTY — see check 3');
    if (i.reasoningTokens !== undefined) {
      console.log(`     reasoning tokens reported: ${i.reasoningTokens}`);
    }
    if (i.reasoning) {
      console.log(`     the proxy returns reasoning separately (${i.reasoning.length} chars in reasoning_content)`);
    }
    if (r.json?.model && r.json.model !== MODEL) {
      console.log(`     the alias resolved to: ${r.json.model}`);
    }
    reachable = true;
  }
}

console.log('\n2. Does the vLLM thinking passthrough get accepted?');
if (!reachable) {
  console.log('  · skipped — the model did not answer check 1, so this would only repeat it.');
} else {
  const r = await call({ ...ASK, max_tokens: BUDGETS.moderatorMessage, chat_template_kwargs: { enable_thinking: false } });
  if (r.status === 200) pass('accepted — keep LLM_DISABLE_THINKING=true');
  else {
    fail(`HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    console.log('     Set LLM_DISABLE_THINKING=false and `docker compose up -d backend`.');
  }
}

console.log('\n3. Do the configured budgets leave room for the answer?');
if (!reachable) {
  console.log('  · skipped — fix check 1 first.');
} else {
  // The documented failure mode: reasoning consumes the budget and the final
  // text never arrives. Every configured budget is tried, the free-text ones
  // first because they are the tight ones.
  const order = [...FREE_TEXT, ...Object.keys(BUDGETS).filter((k) => !FREE_TEXT.includes(k))];
  for (const name of order) {
    const mt = BUDGETS[name];
    const r = await call({ ...ASK, max_tokens: mt, ...AS_PRODUCT });
    if (r.status !== 200) { console.log(`  · ${name} (${mt}): HTTP ${r.status}`); continue; }
    const i = inspect(r);
    const line = `${name} (max_tokens=${mt}): ` +
      (i.content ? `answer present, ${i.content.length} chars` : 'EMPTY ANSWER') +
      ` [finish=${i.finish}, completion=${i.completion}` +
      (i.reasoningTokens !== undefined ? `, reasoning=${i.reasoningTokens}` : '') + ']';
    if (!i.content) {
      fail(line);
      console.log(`     Raise it: ${ENV_VAR[name]}=<bigger> in .env, then docker compose up -d backend.`);
      if (FREE_TEXT.includes(name)) {
        console.log('     Note: this budget also controls reply length on a model that fills it —');
        console.log('     MAX_PERSONA_REPLY_CHARS (2000) is what keeps transcripts bounded afterwards.');
      }
    } else if (AS_PRODUCT.chat_template_kwargs && THINKING_LEAK.test(i.content)) {
      fail(`${line} — reasoning leaked into the answer ("Thinking Process"): the switch did not reach the model`);
    } else {
      pass(line);
    }
  }
}

console.log('\n4. Does a realistic persona-sized prompt still answer?');
if (!reachable) {
  console.log('  · skipped — fix check 1 first.');
} else {
  const r = await call({
    max_tokens: BUDGETS.personaResponse,
    temperature: 0.9,
    presence_penalty: 0.4,
    messages: [
      { role: 'system', content: 'Ты — Алия, 29 лет, маркетолог из Алматы. Отвечай от первого лица, по-русски, 3–4 предложения.' },
      { role: 'user', content: 'Проект поправок предлагает ограничить годовую эффективную ставку по потребительским кредитам. Выскажи свою реакцию.' },
    ],
    ...AS_PRODUCT,
  });
  if (r.status !== 200) fail(`HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  else {
    const i = inspect(r);
    if (!i.content) fail(`empty reply (finish=${i.finish}, completion=${i.completion})`);
    else if (AS_PRODUCT.chat_template_kwargs && THINKING_LEAK.test(i.content)) fail('reasoning leaked into the persona reply ("Thinking Process")');
    else {
      pass(`reply of ${i.content.length} chars in ${r.ms}ms (completion=${i.completion})`);
      if (i.content.length > 2000) {
        console.log('     longer than MAX_PERSONA_REPLY_CHARS (2000) — trimReply will cut it, as designed');
      }
    }
  }
}

console.log(`\n${failures === 0 ? 'OK — this token and model are usable as configured.' : `${failures} problem(s) found.`}`);
process.exit(failures === 0 ? 0 : 1);
