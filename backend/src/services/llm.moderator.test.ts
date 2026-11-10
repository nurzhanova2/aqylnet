import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// BUG-5 regression: generateModeratorMessage must never throw.
//
// It runs inside the round after the persona replies are written and before
// currentIteration moves on. A throw there desynchronised the counter from the
// transcript, and a retry duplicated the persona replies. The old check
// (tests/api/bug5_repro.mjs) needed a deliberately broken LLM key on a live
// backend and was in no suite; this pins the same contract with the client
// failing in-process.
//
// fetch is replaced before llm.service is imported, because the OpenAI client
// captures it when it is constructed (same stub as llm.request.test.ts).

const FALLBACK = 'Давайте уточним: как это конкретно повлияет на основную тему обсуждения?';

let failure: 'http' | 'network' = 'http';
type Llm = typeof import('./llm.service');
let llm: Llm;
const logged: unknown[][] = [];
const consoleError = console.error;

before(async () => {
  process.env.LLM_API_KEY ||= 'test-key';
  globalThis.fetch = (async () => {
    if (failure === 'network') throw new TypeError('fetch failed');
    // 400 is not retried by the SDK, so the call fails at once.
    return new Response(JSON.stringify({ error: { message: 'key_model_access_denied' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  console.error = (...args: unknown[]) => { logged.push(args); };
  llm = await import('./llm.service');
});

after(() => {
  console.error = consoleError;
});

describe('the moderator falls back instead of throwing (BUG-5)', () => {
  test('the proxy answers with an error', async () => {
    failure = 'http';
    const text = await llm.generateModeratorMessage(['Алия: реплика'], 'текст документа', 'цель');
    assert.equal(text, FALLBACK);
  });

  test('the network fails', async () => {
    failure = 'network';
    const text = await llm.generateModeratorMessage(['Алия: реплика'], 'текст документа', 'цель');
    assert.equal(text, FALLBACK);
  });

  test('the failure is logged, not swallowed', () => {
    assert.ok(
      logged.some((args) => String(args[0]).includes('generateModeratorMessage failed')),
      'console.error names the failing call',
    );
  });
});
