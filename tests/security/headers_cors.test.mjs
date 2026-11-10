import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL } from '../api/helpers.mjs';

describe('Security: CORS and error-response hygiene', () => {
  test('CORS: a disallowed Origin does not get reflected in Access-Control-Allow-Origin', async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    assert.notEqual(acao, 'https://evil.example.com', 'server must not reflect an arbitrary Origin back');
    assert.notEqual(acao, '*', 'server must not use a wildcard CORS origin');
  });

  test('CORS: the configured frontend origin IS allowed', async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: 'http://localhost:5174' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  });

  test('a rejected file-type error does not leak a stack trace to the client (message only)', async () => {
    // Since BUG-6 was fixed, an invalid file type is now a clean 400 (see
    // tests/api/documents.test.mjs), not a 500 — but the error-response
    // hygiene contract being checked here (no `stack` key, no filesystem
    // paths in the body) applies regardless of status code.
    const form = new FormData();
    form.append('file', new File(['x'], 'bad.exe', { type: 'application/octet-stream' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.ok(!('stack' in json), 'response body must not include a stack trace');
    assert.ok(!/[A-Za-z]:\\|\/home\/|\/app\//.test(JSON.stringify(json)), 'response body must not include filesystem paths');
  });

  test('there is no authentication requirement on any endpoint — documented, not a "finding" to fix here', async () => {
    // No Authorization header sent at all; every route still responds normally.
    const res = await fetch(`${BASE_URL}/projects`);
    assert.equal(res.status, 200, 'confirms: the entire API surface is unauthenticated by design in the current codebase');
  });
});
