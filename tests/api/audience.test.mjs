import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, projectPayload, deleteProjectSafe } from './helpers.mjs';

// A1 stage 2: document fields and the audience analysis route. No LLM call:
// projects have no personas, so creation computes no positions, and the
// analysis refuses with 409 before any call.

const created = [];
after(async () => { for (const id of created) await deleteProjectSafe(id); });

async function project(overrides = {}) {
  const { status, json } = await api('POST', '/projects', projectPayload([], overrides));
  assert.equal(status, 201, JSON.stringify(json));
  created.push(json.data.id);
  return json.data;
}

describe('Document fields', () => {
  test('created with type, date and audience; returned as sent, no default audience by type', async () => {
    const p = await project({ docType: 'press_release', publishedAt: '2026-09-04', intendedAudience: ['population'] });
    assert.equal(p.docType, 'press_release');
    assert.equal(p.publishedAt, '2026-09-04');
    assert.deepEqual(p.intendedAudience, ['population']);
    const bare = await project({ docType: 'mpr' });
    assert.deepEqual(bare.intendedAudience, [], 'the server applies no default');
  });

  test('PATCH sets and clears; an omitted field is untouched', async () => {
    const p = await project({ docType: 'fsr', intendedAudience: ['experts'] });
    let r = await api('PATCH', `/projects/${p.id}`, { publishedAt: '2026-11-04' });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.docType, 'fsr');
    assert.deepEqual(r.json.data.intendedAudience, ['experts']);
    r = await api('PATCH', `/projects/${p.id}`, { docType: null, intendedAudience: null });
    assert.equal(r.json.data.docType, null);
    assert.deepEqual(r.json.data.intendedAudience, []);
    assert.equal(r.json.data.publishedAt, '2026-11-04');
  });

  test('free strings, impossible dates and an empty audience are 400', async () => {
    const p = await project();
    for (const body of [{ docType: 'пресс-релиз' }, { publishedAt: '2026-02-30' }, { intendedAudience: [] }, { intendedAudience: ['citizens'] }]) {
      const r = await api('PATCH', `/projects/${p.id}`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });
});

describe('Audience analysis', () => {
  test('GET without persona scores: no analysis, no groups; POST is 409', async () => {
    const p = await project({ intendedAudience: ['population'] });
    const g = await api('GET', `/projects/${p.id}/audience-analysis`);
    assert.equal(g.status, 200);
    assert.equal(g.json.data.hasScores, false);
    assert.equal(g.json.data.analysis, null);
    assert.deepEqual(g.json.data.groups, []);
    const r = await api('POST', `/projects/${p.id}/audience-analysis`, {});
    assert.equal(r.status, 409);
    assert.match(r.json.message, /Сначала запустите оценки участников/);
  });

  test('another workspace gets 404 on both routes', async () => {
    const key = crypto.randomUUID();
    const { json } = await api('POST', '/projects', projectPayload([]), { headers: { 'Content-Type': 'application/json', 'X-Session-Key': key } });
    const id = json.data.id;
    try {
      const other = { headers: { 'Content-Type': 'application/json', 'X-Session-Key': crypto.randomUUID() } };
      assert.equal((await api('GET', `/projects/${id}/audience-analysis`, undefined, other)).status, 404);
      assert.equal((await api('POST', `/projects/${id}/audience-analysis`, {}, other)).status, 404);
    } finally {
      await api('DELETE', `/projects/${id}`, undefined, { headers: { 'X-Session-Key': key } });
    }
  });
});
