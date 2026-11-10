import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe } from './helpers.mjs';

let personaAId, personaBId, projectId;

before(async () => {
  const a = await api('POST', '/personas', personaPayload({ name: 'QA-Discussion-A' }));
  const b = await api('POST', '/personas', personaPayload({ name: 'QA-Discussion-B' }));
  personaAId = a.json.data.id;
  personaBId = b.json.data.id;
  const proj = await api('POST', '/projects', projectPayload([personaAId, personaBId]));
  projectId = proj.json.data.id;
});

after(async () => {
  await deleteProjectSafe(projectId);
  await deletePersonaSafe(personaAId);
  await deletePersonaSafe(personaBId);
});

describe('Discussion API (timeline / summary)', () => {
  test('GET /projects/:id/timeline is empty for a fresh project', async () => {
    const { status, json } = await api('GET', `/projects/${projectId}/timeline`);
    assert.equal(status, 200);
    assert.deepEqual(json.data, []);
  });

  test('POST /projects/:id/timeline computes n automatically and ignores a client-supplied n', async () => {
    const { status, json } = await api('POST', `/projects/${projectId}/timeline`, {
      personaId: personaAId, speakerType: 'persona', text: 'first message', n: 999,
    });
    assert.equal(status, 201);
    assert.equal(json.data.n, 1, 'server must compute n=1 for the first message regardless of client input');

    const second = await api('POST', `/projects/${projectId}/timeline`, {
      speakerType: 'moderator', text: 'moderator follow-up',
    });
    assert.equal(second.json.data.n, 2);
    assert.equal(second.json.data.name, 'Модератор');
    assert.equal(second.json.data.personaIdx, -1);
  });

  test('POST /projects/:id/timeline rejects an invalid time format', async () => {
    const { status } = await api('POST', `/projects/${projectId}/timeline`, {
      personaId: personaAId, text: 'x', time: '25:99',
    });
    assert.equal(status, 400);
  });

  test('POST /projects/:id/timeline rejects empty text', async () => {
    const { status } = await api('POST', `/projects/${projectId}/timeline`, {
      personaId: personaAId, text: '',
    });
    assert.equal(status, 400);
  });

  test('PATCH /projects/:id/timeline/:messageId updates only moderator questions', async () => {
    const moderator = await api('POST', `/projects/${projectId}/timeline`, {
      speakerType: 'moderator', text: 'generated follow-up',
    });
    const updated = await api('PATCH', `/projects/${projectId}/timeline/${moderator.json.data.id}`, {
      text: 'edited follow-up with an extra instruction',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.text, 'edited follow-up with an extra instruction');

    const persona = await api('POST', `/projects/${projectId}/timeline`, {
      personaId: personaAId, speakerType: 'persona', text: 'persona reply',
    });
    const rejected = await api('PATCH', `/projects/${projectId}/timeline/${persona.json.data.id}`, {
      text: 'must not be editable',
    });
    assert.equal(rejected.status, 400);
  });

  test('POST /projects/:id/timeline with a personaId not present anywhere returns 404, not a silent null-persona message', async () => {
    const { status, json } = await api('POST', `/projects/${projectId}/timeline`, {
      personaId: 999999999, text: 'ghost speaker',
    });
    assert.equal(status, 404);
    assert.match(json.message, /Persona with id 999999999/);
  });

  test('GET /projects/:id/summary returns null data (200) before a summary is created', async () => {
    const { status, json } = await api('GET', `/projects/${projectId}/summary`);
    assert.equal(status, 200);
    assert.equal(json.data, null);
  });

  test('PUT /projects/:id/summary upserts, and a second PUT overwrites rather than duplicating', async () => {
    const first = await api('PUT', `/projects/${projectId}/summary`, { mood: 'Нейтральное', topics: ['a'] });
    assert.equal(first.status, 200);
    const second = await api('PUT', `/projects/${projectId}/summary`, { mood: 'Позитивное', topics: ['b', 'c'] });
    assert.equal(second.status, 200);
    assert.equal(second.json.data.mood, 'Позитивное');
    assert.deepEqual(second.json.data.topics, ['b', 'c']);

    const { json: getJson } = await api('GET', `/projects/${projectId}/summary`);
    assert.equal(getJson.data.mood, 'Позитивное', 'GET must reflect the latest upsert, not the first insert');
  });

  test('PUT /projects/:id/summary rejects missing required mood field', async () => {
    const { status } = await api('PUT', `/projects/${projectId}/summary`, { topics: [] });
    assert.equal(status, 400);
  });
});

describe('Analytics API', () => {
  test('GET /projects/:id/analytics returns empty-array defaults before any report exists, not a 404', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    const proj = await api('POST', '/projects', projectPayload([persona.json.data.id]));
    try {
      const { status, json } = await api('GET', `/projects/${proj.json.data.id}/analytics`);
      assert.equal(status, 200);
      assert.deepEqual(json.data.conclusions, []);
      assert.deepEqual(json.data.risks, []);
      assert.equal(json.data.personaCount, 1);
    } finally {
      await deleteProjectSafe(proj.json.data.id);
      await deletePersonaSafe(persona.json.data.id);
    }
  });

  test('PUT /projects/:id/analytics validates altParagraphs.color as a hex string', async () => {
    const { status, json } = await api('PUT', `/projects/${projectId}/analytics`, {
      altParagraphs: [{ tag: 'test', text: 'x', color: 'not-hex' }],
    });
    assert.equal(status, 400);
    assert.match(json.message, /color/);
  });

  test('PUT /projects/:id/analytics happy path round-trips through GET', async () => {
    const payload = {
      conclusions: [{ n: 1, text: 'conclusion one' }],
      topicBars: [{ name: 'Topic', pct: 42 }],
      risks: ['risk one'],
      positives: [{ text: 'good thing', by: 'QA-Discussion-A' }],
      recommendations: ['do X'],
      altParagraphs: [{ tag: 'изменено', text: 'reworded', color: '#34d399' }],
    };
    const put = await api('PUT', `/projects/${projectId}/analytics`, payload);
    assert.equal(put.status, 200);
    const get = await api('GET', `/projects/${projectId}/analytics`);
    assert.deepEqual(get.json.data.conclusions, payload.conclusions);
    assert.deepEqual(get.json.data.topicBars, payload.topicBars);
  });
});
