// Regression tests for the access-control fixes in stage E2 of .ai/SECURITY.md.
// Each test below corresponds to a hole that was open in the deployed service,
// so a failure here means one of them has been reopened.
//
// Every project is created WITHOUT documentText on purpose: that is the field
// which triggers the per-document persona positions (LLM scenario 7.2), and
// these tests must not spend tokens or depend on the model being reachable.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, api, personaPayload, projectPayload } from '../api/helpers.mjs';

const ORIGIN = BASE_URL.replace(/\/api\/?$/, '');

const ALICE = crypto.randomUUID();
const BOB = crypto.randomUUID();

// helpers.mjs's `api` spreads opts over the fetch options, so a custom headers
// object replaces the computed one — Content-Type has to be re-added here.
function asKey(key) {
  return (method, path, body) =>
    api(method, path, body, {
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'X-Session-Key': key } : {}),
      },
    });
}

const alice = asKey(ALICE);
const bob = asKey(BOB);
const anon = asKey(null);

const projects = [];
const personas = [];

async function newProject(client, overrides = {}) {
  const { status, json } = await client(
    'POST',
    '/projects',
    projectPayload([], { documentText: undefined, ...overrides }),
  );
  assert.equal(status, 201, `project setup failed: ${JSON.stringify(json)}`);
  projects.push([client, json.data.id]);
  return json.data.id;
}

after(async () => {
  for (const [client, id] of projects) await client('DELETE', `/projects/${id}`).catch(() => {});
  for (const id of personas) await api('DELETE', `/personas/${id}`).catch(() => {});
});

describe('E2: workspace isolation and server-owned invariants', () => {
  // ── item 5 ──────────────────────────────────────────────────
  test('/documents/text cannot write into another workspace\'s project', async () => {
    const id = await newProject(alice);

    const intruder = await bob('POST', '/documents/text', {
      text: 'Текст, подсунутый чужим клиентом. Должен быть отвергнут.',
      projectId: id,
    });
    assert.equal(intruder.status, 404, 'another workspace must not reach this project');

    // 404, never 403: a 403 would confirm the id exists and merely belongs to
    // someone else, which is exactly what an id-guessing caller wants to learn.
    assert.match(intruder.json.message, /not found/i);

    const owner = await alice('POST', '/documents/text', {
      text: 'Законный текст владельца проекта, достаточной длины для проверки.',
      projectId: id,
    });
    assert.equal(owner.status, 201, 'the owner must still be able to write');
  });

  test('/documents/upload cannot write into another workspace\'s project', async () => {
    const id = await newProject(alice);

    const form = new FormData();
    form.append('file', new File(['чужой документ'], 'intruder.txt', { type: 'text/plain' }));
    form.append('projectId', String(id));

    const res = await fetch(`${BASE_URL}/documents/upload`, {
      method: 'POST',
      headers: { 'X-Session-Key': BOB },
      body: form,
    });
    assert.equal(res.status, 404);
  });

  test('GET /projects/:id hides another workspace\'s project as 404, not 403', async () => {
    const id = await newProject(alice);
    assert.equal((await bob('GET', `/projects/${id}`)).status, 404);
    assert.equal((await alice('GET', `/projects/${id}`)).status, 200);
  });

  test('a project with no owner key stays visible to everyone (legacy data invariant)', async () => {
    // Rows created without X-Session-Key carry ownerKey = null, which is how
    // pre-existing data behaves. Turning this into "forbidden" would make an
    // existing database look empty — the guard must keep letting it through.
    const id = await newProject(anon);
    assert.equal((await alice('GET', `/projects/${id}`)).status, 200);
    assert.equal((await bob('GET', `/projects/${id}`)).status, 200);
  });

  // ── item 6 ──────────────────────────────────────────────────
  test('/uploads is not served at all', async () => {
    const res = await fetch(`${ORIGIN}/uploads/doc-00000000-0000-4000-8000-000000000000.pdf`);
    assert.equal(res.status, 404, 'uploaded documents must not be publicly fetchable');
  });

  // ── item 20 ─────────────────────────────────────────────────
  test('stored upload names come from a CSPRNG, not a timestamp', async () => {
    const form = new FormData();
    form.append('file', new File(['короткий текстовый документ'], 'probe.txt', { type: 'text/plain' }));
    const res = await fetch(`${BASE_URL}/documents/upload`, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const { data } = await res.json();
    assert.match(
      data.storedName,
      /^doc-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/,
      `expected a UUID v4 name, got ${data.storedName}`,
    );
  });

  // ── item 19 ─────────────────────────────────────────────────
  test('PUT /analytics ignores a client-supplied overallScore and recomputes it', async () => {
    // A1 stage 0a: only a finding whose quote is in the document caps the
    // score, so the document has to contain it.
    const id = await newProject(alice, { documentText: 'Текст документа, где есть дословная цитата для проверки.' });

    const { status, json } = await alice('PUT', `/projects/${id}/analytics`, {
      conclusions: [{ n: 1, text: 'проверка' }],
      extras: {
        // A perfect score next to a Critical issue — the combination the
        // computed value is specifically designed to refuse.
        overallScore: 100,
        scores: [
          { key: 'clarity', label: 'Ясность', value: 80 },
          { key: 'evidence', label: 'Доказательность', value: 80 },
          { key: 'relevance', label: 'Релевантность', value: 80 },
          { key: 'trust', label: 'Доверие', value: 80 },
        ],
        issues: [{
          code: 'I1', title: 'Критичный дефект', category: 'Риск',
          severity: 'Critical', quote: 'дословная цитата',
        }],
      },
    });

    assert.equal(status, 200);
    // mean of the axes is 80, and a Critical issue caps the result at 55.
    assert.equal(json.data.overallScore, 55, 'the aggregate must be computed in code, not accepted');
  });

  // ── item 7 ──────────────────────────────────────────────────
  test('a persona that has spoken in a discussion cannot be deleted', async () => {
    const created = await api('POST', '/personas', personaPayload());
    assert.equal(created.status, 201);
    const personaId = created.json.data.id;
    personas.push(personaId);

    const projectId = await newProject(alice, { personaIds: [personaId] });

    // Posted directly rather than generated: this route touches no LLM.
    const msg = await alice('POST', `/projects/${projectId}/timeline`, {
      personaId, speakerType: 'persona', text: 'Реплика для проверки guard-а.', iteration: 1,
    });
    assert.equal(msg.status, 201);

    const del = await api('DELETE', `/personas/${personaId}`);
    assert.equal(del.status, 409, 'TimelineMessage.persona is SetNull — deleting would blank the speaker');
    assert.match(del.json.message, /spoken|cast/i);
  });

  test('a persona with no references is still deletable', async () => {
    const created = await api('POST', '/personas', personaPayload());
    assert.equal(created.status, 201);
    const { status } = await api('DELETE', `/personas/${created.json.data.id}`);
    assert.equal(status, 200, 'the guard must not make the library undeletable');
  });
});
