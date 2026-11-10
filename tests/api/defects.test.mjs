import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe } from './helpers.mjs';

describe('BUG-8 (fixed): unexpected internal errors no longer leak raw Prisma/DB internals to the client', () => {
  test('a value that fails deep inside the Prisma client (not caught by our own validators) returns a sanitized 500', async () => {
    // Numeric-id routes only zod-validate "is this parseable as a number" —
    // a value like this parses fine in JS but overflows Postgres's bigint,
    // so it fails inside @prisma/client itself, not in our validators. Before
    // the fix, errorHandler's generic Error branch echoed the raw
    // PrismaClientValidationError text verbatim, including a full in-container
    // file path and the query's field/table structure.
    const { status, json } = await api('GET', '/projects/999999999999999999999999');
    assert.equal(status, 500);
    assert.equal(json.success, false);
    assert.equal(json.message, 'An unexpected server error occurred.', 'FIXED: generic message, not the raw Prisma error text');
    assert.doesNotMatch(json.message, /prisma|\.ts:\d+|\/app\/|[A-Za-z]:\\\\/i, 'must not leak Prisma internals, file paths, or line numbers');
  });

  test('a controlled domain error (404) is unaffected by the generic-error sanitization', async () => {
    // Guards against over-broad sanitization swallowing legitimate,
    // already-safe AppError messages along with the generic Error branch.
    const { status, json } = await api('GET', '/projects/999999999');
    assert.equal(status, 404);
    assert.match(json.message, /not found/i);
  });
});

describe('BUG-1 (fixed): a persona that cannot be deleted says so cleanly', () => {
  // Originally two tests, both about a Dialog row holding the FK. Dialog is
  // gone (SECURITY.md item 34) and so is that failure mode, but the property
  // was never about Dialog: deleting a persona that is referenced anywhere
  // must be a 409 whose message does not leak Prisma constraint text. Pointed
  // at ProjectPersona, which blocks a delete and had no test of its own; the
  // TimelineMessage relation is covered in tests/security/workspace_isolation.
  test('DELETE /personas/:id returns 409 while the persona is in a project cast, without leaking Prisma/DB internals', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-CastGuard' }));
    assert.equal(persona.status, 201, JSON.stringify(persona.json));
    const personaId = persona.json.data.id;

    const proj = await api('POST', '/projects', projectPayload([personaId]));
    assert.equal(proj.status, 201, JSON.stringify(proj.json));
    const projectId = proj.json.data.id;

    const del = await api('DELETE', `/personas/${personaId}`);
    assert.equal(del.status, 409, 'a persona still in a project cast must be a clean 409');
    assert.doesNotMatch(
      del.json.message,
      /foreign key|constraint|prisma/i,
      'the 409 message must not leak raw Prisma/DB constraint internals',
    );

    const stillThere = await api('GET', `/personas/${personaId}`);
    assert.equal(stillThere.status, 200, 'persona must still exist after the 409 (no partial delete)');

    // Removing the project releases the cast, which unblocks the delete.
    await deleteProjectSafe(projectId);
    const after = await api('DELETE', `/personas/${personaId}`);
    assert.equal(after.status, 200, 'with no references left the persona is deletable');
  });

  test('the dialog endpoints are gone, not quietly returning an empty list', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-NoDialogs' }));
    const personaId = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([personaId]));
    const projectId = proj.json.data.id;

    // 404 from the router, not 200 with []: a half-reverted removal that left
    // the route in place would otherwise pass unnoticed.
    const get = await api('GET', `/projects/${projectId}/dialogs`);
    assert.equal(get.status, 404, `GET /dialogs must not exist: ${JSON.stringify(get.json)}`);
    const post = await api('POST', `/projects/${projectId}/dialogs`, { fromPersonaId: personaId, toPersonaId: personaId, text: 'x' });
    assert.equal(post.status, 404, 'POST /dialogs must not exist');

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(personaId);
  });
});

describe('BUG-2 (fixed): LLM-derived per-document stance override is now reachable — SetupPage only sends personaStances for touched personas', () => {
  test('the API path this fix relies on: personaStances omitted for a persona lets the LLM-derived stance apply', async () => {
    // Before the fix, SetupPage.jsx's stanceFor()/handleLaunch() always
    // populated personaStances for every selected persona, so this API-level
    // path — while always supported by the backend — was structurally
    // unreachable from the real UI. It's now exactly what the fixed
    // SetupPage.jsx sends for a persona the user didn't touch (see the
    // deterministic e2e proof of the actual payload in
    // tests/e2e/defects.test.mjs, and the deterministic prompt-content proof
    // in backend/src/services/llm.service.stance.test.ts).
    const persona = await api('POST', '/personas', personaPayload({ stance: 'Нейтральный' }));
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], {
      personaStances: {}, // <- what the fixed SetupPage now sends for an untouched persona
      documentText: 'Документ, напрямую влияющий на интересы отрасли этой персоны.',
    }));
    assert.equal(proj.status, 201);
    // We do not assert on the LLM-derived stance value itself (non-deterministic
    // model output) — that determinism gap is covered separately by
    // llm.service.stance.test.ts, which asserts on prompt content directly
    // without a live LLM call. This test only proves the code path itself
    // executes successfully end-to-end.
    await deleteProjectSafe(proj.json.data.id);
    await deletePersonaSafe(pid);
  });
});

describe('generate-report idempotency and validation', () => {
  test('POST /projects/:id/generate-report on a project with no document text returns 400', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], { documentText: undefined }));
    const projectId = proj.json.data.id;

    const { status, json } = await api('POST', `/projects/${projectId}/generate-report`);
    assert.equal(status, 400);
    assert.match(json.message, /document/i);

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });

  test('POST /projects/:id/generate-report on a project with no timeline messages returns 400', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid]));
    const projectId = proj.json.data.id;

    const { status, json } = await api('POST', `/projects/${projectId}/generate-report`);
    assert.equal(status, 400);
    assert.match(json.message, /messages/i);

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });
});

describe('BUG-7 (fixed): moderator setting is honored end-to-end (backend was already correct; App.jsx now actually calls it)', () => {
  test('PATCH /projects/:id { moderator } persists and the response DTO reflects the saved value', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], { moderator: true }));
    const projectId = proj.json.data.id;

    const patchOff = await api('PATCH', `/projects/${projectId}`, { moderator: false });
    assert.equal(patchOff.status, 200);
    assert.equal(patchOff.json.data.moderator, false);

    const reread = await api('GET', `/projects/${projectId}`);
    assert.equal(reread.json.data.moderator, false, 'value must survive a fresh GET, not just the PATCH response');

    const patchOn = await api('PATCH', `/projects/${projectId}`, { moderator: true });
    assert.equal(patchOn.json.data.moderator, true, 'toggling back on must also persist');

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });

  test('creating a project without an explicit moderator field defaults to true', async () => {
    const persona = await api('POST', '/personas', personaPayload());
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], { moderator: undefined }));
    assert.equal(proj.json.data.moderator, true, 'CreateProjectSchema default');

    await deleteProjectSafe(proj.json.data.id);
    await deletePersonaSafe(pid);
  });

  test('run-iteration generates a moderator message when moderator is enabled', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-Mod-Enabled', responseLength: 'Короткий' }));
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], { moderator: true }));
    const projectId = proj.json.data.id;

    const iter = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(iter.status, 200);

    const timeline = await api('GET', `/projects/${projectId}/timeline`);
    const speakerTypes = timeline.json.data.map((m) => m.speakerType);
    assert.ok(speakerTypes.includes('moderator'), 'moderator=true must produce a moderator message in the timeline');

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });

  test('run-iteration does NOT generate a moderator message when moderator is disabled', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-Mod-Disabled', responseLength: 'Короткий' }));
    const pid = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([pid], { moderator: false }));
    const projectId = proj.json.data.id;
    assert.equal(proj.json.data.moderator, false, 'precondition');

    const iter = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(iter.status, 200);

    const timeline = await api('GET', `/projects/${projectId}/timeline`);
    const speakerTypes = timeline.json.data.map((m) => m.speakerType);
    assert.ok(!speakerTypes.includes('moderator'), 'moderator=false must NOT produce a moderator message');
    assert.deepEqual([...new Set(speakerTypes)], ['persona'], 'only persona messages should exist for this iteration');

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });
});

describe('the standalone moderator-message route is gone', () => {
  // It took an `iteration` from the body (E7 item 26 bounded it), but no client
  // ever called it, and it was the one LLM route outside the daily token
  // ceiling. The moderator question is generated inside the round.
  test('POST /projects/:id/moderator-message is a 404, not a generation', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-NoModeratorRoute', responseLength: 'Короткий' }));
    assert.equal(persona.status, 201, JSON.stringify(persona.json));
    const personaId = persona.json.data.id;
    const proj = await api('POST', '/projects', projectPayload([personaId], { moderator: true, iterations: 2 }));
    assert.equal(proj.status, 201, JSON.stringify(proj.json));
    const projectId = proj.json.data.id;

    // 404 from the router: a half-reverted removal that left the route in
    // place would answer 200 (and spend tokens) or 400 on the body.
    const post = await api('POST', `/projects/${projectId}/moderator-message`, { iteration: 1 });
    assert.equal(post.status, 404, `POST /moderator-message must not exist: ${JSON.stringify(post.json)}`);

    const timeline = await api('GET', `/projects/${projectId}/timeline`);
    assert.deepEqual(timeline.json.data, [], 'nothing may have been written to the timeline');

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(personaId);
  });
});

describe('E7 item 27 (fixed): a repeated personaId is deduplicated, not a 500', () => {
  test('POST /projects with the same id three times creates the project with one persona', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-Dup-Persona', responseLength: 'Короткий' }));
    assert.equal(persona.status, 201, JSON.stringify(persona.json));
    const pid = persona.json.data.id;

    // Hit ProjectPersona's unique (projectId, personaId) before the fix.
    const proj = await api('POST', '/projects', projectPayload([pid, pid, pid]));
    assert.equal(proj.status, 201, `expected the duplicate to be absorbed: ${JSON.stringify(proj.json)}`);
    const projectId = proj.json.data.id;

    const members = await api('GET', `/projects/${projectId}/personas`);
    assert.equal(members.status, 200);
    assert.equal(members.json.data.length, 1, 'the persona must appear once, not three times');
    assert.equal(members.json.data[0].id, pid);

    await deleteProjectSafe(projectId);
    await deletePersonaSafe(pid);
  });

  test('the array cap still counts the raw request, duplicates included', async () => {
    const persona = await api('POST', '/personas', personaPayload({ name: 'QA-Dup-Cap', responseLength: 'Короткий' }));
    const pid = persona.json.data.id;

    // Nine entries, one unique id. Deduplication happens in the service; the
    // validator's cap is about the size of the request and is unchanged.
    const { status } = await api('POST', '/projects', projectPayload(Array(9).fill(pid)));
    assert.equal(status, 400, 'the cap must still reject an oversized array');

    await deletePersonaSafe(pid);
  });
});
