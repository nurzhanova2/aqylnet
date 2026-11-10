import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, projectPayload, deleteProjectSafe } from './helpers.mjs';

// A1 stage 3: the rewrite routes refuse before any LLM call — no audience
// analysis is 409, an unknown layer is 400, another workspace is 404.

const created = [];
after(async () => { for (const id of created) await deleteProjectSafe(id); });

describe('Three versions of the text', () => {
  test('GET without an audience analysis: no versions; POST all and POST one layer are 409', async () => {
    const { json } = await api('POST', '/projects', projectPayload([]));
    created.push(json.data.id);
    const g = await api('GET', `/projects/${json.data.id}/rewrites`);
    assert.equal(g.status, 200);
    assert.equal(g.json.data.hasAnalysis, false);
    assert.deepEqual([g.json.data.card, g.json.data.brief, g.json.data.full], [null, null, null]);
    for (const url of [`/projects/${json.data.id}/rewrites`, `/projects/${json.data.id}/rewrites/card`]) {
      const r = await api('POST', url, {});
      assert.equal(r.status, 409, url);
      assert.match(r.json.message, /Сначала запустите анализ «Кому понятен текст»/);
    }
  });

  test('an unknown layer is 400', async () => {
    const { json } = await api('POST', '/projects', projectPayload([]));
    created.push(json.data.id);
    const r = await api('POST', `/projects/${json.data.id}/rewrites/poem`, {});
    assert.equal(r.status, 400);
  });

  test('another workspace gets 404', async () => {
    const key = crypto.randomUUID();
    const { json } = await api('POST', '/projects', projectPayload([]), { headers: { 'Content-Type': 'application/json', 'X-Session-Key': key } });
    try {
      const other = { headers: { 'Content-Type': 'application/json', 'X-Session-Key': crypto.randomUUID() } };
      assert.equal((await api('GET', `/projects/${json.data.id}/rewrites`, undefined, other)).status, 404);
      assert.equal((await api('POST', `/projects/${json.data.id}/rewrites/card`, {}, other)).status, 404);
    } finally {
      await api('DELETE', `/projects/${json.data.id}`, undefined, { headers: { 'X-Session-Key': key } });
    }
  });
});
