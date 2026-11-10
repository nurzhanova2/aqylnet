// Shared plumbing for the 15-page measurement (.ai/MEASUREMENTS-15PAGES.md).
//
// Every script here talks to LiteLLM directly, past LlmUsage, so the one thing
// standing between a measurement and the shared daily quota is the ledger
// below. It is a file, not a variable, so the cap holds across scripts and
// across reruns: each call reserves its worst case (estimated prompt plus
// max_tokens) *before* it is sent, and nothing is sent that could cross the cap.
//
// Run inside the backend container, which trusts the intercepting proxy root:
//
//   docker compose cp scripts/measure backend:/tmp/measure
//   docker compose exec backend node /tmp/measure/01-model-info.mjs
//
// node:https rather than fetch: undici's fetch has a 300 s headers timeout that
// cannot be raised without importing undici, and prefilling a 128k-token
// prompt can plausibly take longer than that.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

export const BASE = (process.env.LLM_API_BASE || 'https://prod-litellm.nationalbank.kz').replace(/\/$/, '');
export const MODEL = process.env.LLM_MODEL || 'assistant-balanced';
const KEY = process.env.LLM_API_KEY || '';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.MEASURE_OUT || path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const LEDGER = path.join(OUT, 'ledger.json');
export const TOKEN_CAP = Number(process.env.MEASURE_TOKEN_CAP ?? 600_000);
/** Stop well before the cap — the last call's reservation is an estimate. */
export const SOFT_CAP = Math.floor(TOKEN_CAP * 0.9);

export class StopError extends Error {}

export function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); }
  catch { return { total: 0, prompt: 0, completion: 0, calls: [] }; }
}

function writeLedger(l) { fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2), 'utf8'); }

export function spent() { return readLedger().total; }

/** Throws if text was corrupted on the way in — the failure mode from SECURITY §12. */
export function assertClean(text, what) {
  const bad = (text.match(/�/g) || []).length;
  if (bad) throw new StopError(`${what}: ${bad} U+FFFD characters — the text did not arrive intact`);
  return text;
}

export function readUtf8(file) {
  const buf = fs.readFileSync(file);
  if (buf.includes(Buffer.from([0xef, 0xbf, 0xbd]))) throw new StopError(`${file}: contains efbfbd`);
  return assertClean(buf.toString('utf8'), file);
}

function request(method, urlPath, body, timeoutMs) {
  const url = new URL(BASE + urlPath);
  const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        ...(payload ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, ms: Date.now() - started, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', (e) => resolve({ status: 0, headers: {}, ms: Date.now() - started, text: '', json: null, error: e.code || e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

export async function get(urlPath) {
  if (!KEY) throw new StopError('LLM_API_KEY is empty');
  return request('GET', urlPath, null, 60_000);
}

/**
 * One chat completion, accounted.
 *
 * `reserve` is the caller's worst-case estimate in tokens; if it would carry
 * the ledger past SOFT_CAP the call is not sent. 429 and 403 stop the whole
 * run, per the brief: they are a signal to ask, not to retry.
 */
export async function chat(body, { label, reserve, timeoutMs = 900_000 }) {
  if (!KEY) throw new StopError('LLM_API_KEY is empty');
  const before = readLedger();
  if (before.total + reserve > SOFT_CAP) {
    throw new StopError(`budget: ${before.total} spent + ${reserve} reserved > soft cap ${SOFT_CAP}`);
  }
  for (const m of body.messages) assertClean(m.content, `${label} message`);

  const r = await request('POST', '/v1/chat/completions', { model: MODEL, ...body }, timeoutMs);
  const usage = r.json?.usage ?? {};
  const choice = r.json?.choices?.[0];
  const message = choice?.message ?? {};
  const out = {
    label,
    status: r.status,
    error: r.error ?? (r.status !== 200 ? (r.json?.error?.message ?? r.text.slice(0, 300)) : undefined),
    ms: r.ms,
    model: r.json?.model,
    finish: choice?.finish_reason,
    prompt: usage.prompt_tokens ?? 0,
    completion: usage.completion_tokens ?? 0,
    total: usage.total_tokens ?? ((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)),
    cached: usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    usageRaw: usage,
    content: message.content ?? '',
    reasoning: message.reasoning_content ?? message.reasoning ?? '',
    headers: pickHeaders(r.headers),
  };

  const l = readLedger();
  l.total += out.total; l.prompt += out.prompt; l.completion += out.completion;
  l.calls.push({ at: new Date().toISOString(), label, status: out.status, prompt: out.prompt, completion: out.completion, total: out.total, ms: out.ms });
  writeLedger(l);

  if (r.status === 429 || r.status === 403) {
    throw new StopError(`HTTP ${r.status} on ${label}: ${out.error}`);
  }
  return out;
}

/** Response headers that say something about the backend; never the auth ones. */
export function pickHeaders(h = {}) {
  const keep = {};
  for (const [k, v] of Object.entries(h)) {
    if (/^(x-litellm|llm_provider|x-ratelimit|server$|x-request-id|x-model)/i.test(k) && !/key|auth|token|user|team/i.test(k)) keep[k] = v;
  }
  return keep;
}

export function save(name, data) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`→ ${file}`);
}

export function ledgerLine() {
  const l = readLedger();
  return `ledger: ${l.total} tokens (${l.calls.length} calls), soft cap ${SOFT_CAP}`;
}

/** Runs a script body and turns StopError into a clean, explained exit. */
export async function main(fn) {
  try { await fn(); console.log(ledgerLine()); }
  catch (e) {
    console.log(`\nSTOP: ${e.message}`);
    console.log(ledgerLine());
    process.exit(e instanceof StopError ? 2 : 1);
  }
}
