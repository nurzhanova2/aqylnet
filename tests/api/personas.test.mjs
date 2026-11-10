import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, personaPayload, deletePersonaSafe } from './helpers.mjs';

const createdIds = [];
after(async () => {
  for (const id of createdIds) await deletePersonaSafe(id);
});

describe('Personas API', () => {
  test('GET /personas returns a non-empty array with expected DTO shape', async () => {
    const { status, json } = await api('GET', '/personas');
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length > 0);
    const p = json.data[0];
    for (const key of ['id', 'name', 'role', 'dot', 'seat', 'model', 'interests', 'context']) {
      assert.ok(key in p, `PersonaDTO missing field "${key}"`);
    }
    assert.ok('l' in p.seat && 't' in p.seat, 'seat must be {l,t}');
  });

  test('POST /personas creates a persona with minimal valid payload and applies defaults', async () => {
    const { status, json } = await api('POST', '/personas', personaPayload());
    assert.equal(status, 201);
    assert.equal(json.success, true);
    createdIds.push(json.data.id);
    assert.equal(json.data.responseLength, 'Средний', 'default responseLength should apply');
    assert.equal(json.data.avatarIdx, 0, 'default avatarIdx should be 0');
    assert.deepEqual(json.data.interests, []);
  });

  test('POST /personas rejects missing required field (name)', async () => {
    const payload = personaPayload();
    delete payload.name;
    const { status, json } = await api('POST', '/personas', payload);
    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.match(json.message, /name/);
  });

  test('POST /personas rejects invalid dot color format', async () => {
    const { status, json } = await api('POST', '/personas', personaPayload({ dot: 'not-a-color' }));
    assert.equal(status, 400);
    assert.match(json.message, /dot/);
  });

  test('POST /personas accepts avatarIdx up to 33 and rejects 34', async () => {
    // The bound was 7 when this test was written, 31 later, and is 33 since A1
    // stage 1 added two seed personas (MAX_AVATAR_IDX in config/limits.ts): a
    // lower limit rejects a PATCH of an existing persona that merely echoes back
    // its own avatarIdx (see the comment in validators/persona.validator.ts).
    const high = await api('POST', '/personas', personaPayload({ avatarIdx: 33 }));
    assert.equal(high.status, 201, `33 is a real persona's value: ${JSON.stringify(high.json)}`);
    await deletePersonaSafe(high.json.data.id);

    const over = await api('POST', '/personas', personaPayload({ avatarIdx: 34 }));
    assert.equal(over.status, 400);
  });

  test('POST /personas rejects unknown/extra top-level type mismatch (interests as string, not array)', async () => {
    const { status } = await api('POST', '/personas', personaPayload({ interests: 'not-an-array' }));
    assert.equal(status, 400);
  });

  test('POST /personas accepts and safely stores strings containing SQL-metacharacters without executing them', async () => {
    const maliciousName = `QA'; DROP TABLE "Persona"; --`;
    const { status, json } = await api('POST', '/personas', personaPayload({ name: maliciousName }));
    assert.equal(status, 201);
    createdIds.push(json.data.id);
    assert.equal(json.data.name, maliciousName, 'value must be stored verbatim, not interpreted as SQL');

    // Table must still exist and be queryable — proves no injection occurred.
    const { status: listStatus, json: listJson } = await api('GET', '/personas');
    assert.equal(listStatus, 200);
    assert.ok(listJson.data.some((p) => p.id === json.data.id));
  });

  test('POST /personas accepts and safely stores strings containing HTML/script tags (stored-XSS payload) as inert text', async () => {
    const xssPayload = '<script>alert(document.cookie)</script>';
    const { status, json } = await api('POST', '/personas', personaPayload({ thinking: xssPayload }));
    assert.equal(status, 201);
    createdIds.push(json.data.id);
    assert.equal(json.data.thinking, xssPayload, 'API must return the raw string — encoding is a render-time (React) concern, not a storage concern');
  });

  test('GET /personas/:id returns 404 for a non-existent id', async () => {
    const { status, json } = await api('GET', '/personas/999999999');
    assert.equal(status, 404);
    assert.equal(json.success, false);
  });

  test('GET /personas/:id returns 400 for a non-numeric id', async () => {
    const { status } = await api('GET', '/personas/not-a-number');
    assert.equal(status, 400);
  });

  test('GET /personas/:id returns 400 for a negative id', async () => {
    const { status } = await api('GET', '/personas/-1');
    assert.equal(status, 400);
  });

  test('PATCH /personas/:id partially updates and preserves untouched fields', async () => {
    const { json: created } = await api('POST', '/personas', personaPayload({ role: 'Original Role' }));
    createdIds.push(created.data.id);
    const { status, json } = await api('PATCH', `/personas/${created.data.id}`, { role: 'Updated Role' });
    assert.equal(status, 200);
    assert.equal(json.data.role, 'Updated Role');
    assert.equal(json.data.name, created.data.name, 'name should be unchanged by partial update');
  });

  test('PATCH /personas/:id returns 404 for a non-existent id', async () => {
    const { status } = await api('PATCH', '/personas/999999999', { role: 'x' });
    assert.equal(status, 404);
  });

  test('PATCH /personas/:id replaces contexts wholesale when contexts key is present', async () => {
    const { json: created } = await api('POST', '/personas', personaPayload({
      contexts: [{ src: 'p.1', quote: 'original quote' }],
    }));
    createdIds.push(created.data.id);
    assert.equal(created.data.context.length, 1);

    const { json: updated } = await api('PATCH', `/personas/${created.data.id}`, {
      contexts: [{ src: 'p.2', quote: 'new quote A' }, { src: 'p.3', quote: 'new quote B' }],
    });
    assert.equal(updated.data.context.length, 2, 'old context rows must be replaced, not appended to');
  });

  test('DELETE /personas/:id removes the persona (happy path, no relations)', async () => {
    const { json: created } = await api('POST', '/personas', personaPayload());
    const { status } = await api('DELETE', `/personas/${created.data.id}`);
    assert.equal(status, 200);
    const { status: getStatus } = await api('GET', `/personas/${created.data.id}`);
    assert.equal(getStatus, 404, 'persona must actually be gone after delete');
  });

  test('DELETE /personas/:id returns 404 for a non-existent id (not idempotent-200)', async () => {
    const { status } = await api('DELETE', '/personas/999999999');
    assert.equal(status, 404);
  });
});
