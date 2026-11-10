// Slow, LLM-backed tests kept separate from the fast validation suite.
// Run explicitly: node --test tests/api/concurrency.test.mjs
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe } from './helpers.mjs';
import { hasGrantedAdvisoryLock, query } from './db.mjs';

const createdPersonaIds = [];
const createdProjectIds = [];
after(async () => {
  for (const id of createdProjectIds) await deleteProjectSafe(id);
  for (const id of createdPersonaIds) await deletePersonaSafe(id);
});

describe('BUG-4 (fixed): concurrent POST /projects/:id/run-iteration on the same project is serialized by a transaction-scoped advisory lock', () => {
  test('two simultaneous run-iteration calls on the same project: exactly one succeeds, the other is rejected, no duplicate messages, no stale lock', async (t) => {
    const persona = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
    const pid = persona.json.data.id;
    createdPersonaIds.push(pid);
    const proj = await api('POST', '/projects', projectPayload([pid], { iterations: 5, moderator: true }));
    const projectId = proj.json.data.id;
    createdProjectIds.push(projectId);

    // Fire both requests back-to-back without awaiting the first — this is
    // exactly what happens if a user double-clicks Play, or if two browser
    // tabs are open on the same project. We don't assert on WHICH one wins
    // (that's a legitimate race) — only on the outcome invariant: exactly
    // one succeeds, the other is rejected, and the resulting state reflects
    // exactly one completed iteration.
    const [r1, r2] = await Promise.allSettled([
      api('POST', `/projects/${projectId}/run-iteration`),
      api('POST', `/projects/${projectId}/run-iteration`),
    ]);

    const results = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value : { status: 'rejected', error: r.reason }));
    t.diagnostic(`call 1: ${JSON.stringify(results[0]).slice(0, 300)}`);
    t.diagnostic(`call 2: ${JSON.stringify(results[1]).slice(0, 300)}`);

    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(
      statuses, [200, 409],
      'business invariant: exactly one concurrent call must succeed (200) and the other must be rejected (409) — never both 200 (duplicate iterations) and never both 409 (deadlock)',
    );

    const loser = results.find((r) => r.status === 409);
    assert.match(loser.json.message, /already running/i);

    const timeline = await api('GET', `/projects/${projectId}/timeline`);
    const project = await api('GET', `/projects/${projectId}`);
    assert.equal(timeline.json.data.length, 2, 'exactly one iteration worth of rows (1 persona + 1 moderator), no duplicate set from the losing call');
    assert.equal(project.json.data.currentIteration, 1);
    const iterationTags = new Set(timeline.json.data.map((m) => m.iteration));
    assert.deepEqual([...iterationTags], [1], 'no message may be tagged with any iteration other than the one that actually completed');

    // BUG-4 corrective-fix invariant: the transaction-scoped advisory lock
    // must be gone the moment the transaction that held it (winner or
    // loser) finishes — Postgres releases it automatically on COMMIT/
    // ROLLBACK. A stale lock here would mean the fix regressed back to a
    // session-scoped/leakable implementation.
    assert.equal(
      await hasGrantedAdvisoryLock(projectId), false,
      'no advisory lock may remain held for this project once both concurrent calls have finished',
    );

    // Regression guard: the lock must be released after the winning call
    // completes, not held forever — an immediate next (sequential) call must
    // succeed as iteration 2, not a false 409.
    const r3 = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(r3.status, 200, 'lock must be released after the previous call finishes — next sequential call must not be blocked');
    assert.equal(r3.json.data.currentIteration, 2);
    assert.equal(await hasGrantedAdvisoryLock(projectId), false, 'no stale lock after the sequential follow-up call either');
  });

  test('concurrent run-iteration calls on two different projects do not block each other (lock is per-project, not global)', async () => {
    const p1 = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
    const p2 = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
    createdPersonaIds.push(p1.json.data.id, p2.json.data.id);
    const proj1 = await api('POST', '/projects', projectPayload([p1.json.data.id], { iterations: 5, moderator: true }));
    const proj2 = await api('POST', '/projects', projectPayload([p2.json.data.id], { iterations: 5, moderator: true }));
    createdProjectIds.push(proj1.json.data.id, proj2.json.data.id);

    const [r1, r2] = await Promise.allSettled([
      api('POST', `/projects/${proj1.json.data.id}/run-iteration`),
      api('POST', `/projects/${proj2.json.data.id}/run-iteration`),
    ]);

    assert.equal(r1.status === 'fulfilled' && r1.value.status, 200, 'project 1 call must succeed');
    assert.equal(r2.status === 'fulfilled' && r2.value.status, 200, 'project 2 call must succeed — a different project must never be blocked by another project\'s lock');

    assert.equal(await hasGrantedAdvisoryLock(proj1.json.data.id), false);
    assert.equal(await hasGrantedAdvisoryLock(proj2.json.data.id), false);
  });

  test('a guard failure inside the transaction (e.g. "No document text") rolls back cleanly and releases the lock — no LLM call needed to prove this', async () => {
    // Deterministic substitute for an LLM-outage rollback: any thrown error
    // inside runIteration's transaction callback (regardless of source)
    // goes through the exact same Prisma rollback + automatic
    // pg_try_advisory_xact_lock release path. Using a guard that throws
    // BEFORE any LLM call keeps this test fast and independent of the real
    // LiteLLM proxy, while still exercising the real rollback machinery.
    const persona = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
    const pid = persona.json.data.id;
    createdPersonaIds.push(pid);
    const proj = await api('POST', '/projects', projectPayload([pid], {
      iterations: 5, moderator: true, documentText: undefined,
    }));
    const projectId = proj.json.data.id;
    createdProjectIds.push(projectId);
    assert.equal(proj.json.data.documentText, null, 'precondition: project has no document text');

    const failed = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(failed.status, 400);
    assert.match(failed.json.message, /document/i);

    assert.equal(
      await hasGrantedAdvisoryLock(projectId), false,
      'a thrown guard error must roll back the transaction and release the lock immediately, not leave it held',
    );

    const project = await api('GET', `/projects/${projectId}`);
    assert.equal(project.json.data.currentIteration, 0, 'rollback must undo any partial state — currentIteration must not have advanced');

    const timeline = await api('GET', `/projects/${projectId}/timeline`);
    assert.equal(timeline.json.data.length, 0, 'rollback must undo any partial state — no messages may have been persisted');

    // The project is now permanently stuck for iteration purposes (no
    // document text was ever a legitimate state to run from), but the
    // invariant under test is purely: does the lock get released? A
    // subsequent call must still fail with the SAME guard, not a false 409.
    const again = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(again.status, 400, 'the lock release must not be masked by a leftover 409 — the same deterministic guard must fire again');
  });
});

describe('concurrent POST /projects/:id/generate-report on the same project runs once', () => {
  test('two simultaneous calls: one 200, one 409, and the model is paid for one report', async (t) => {
    const persona = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
    const pid = persona.json.data.id;
    createdPersonaIds.push(pid);
    const proj = await api('POST', '/projects', projectPayload([pid], { iterations: 2, moderator: false }));
    const projectId = proj.json.data.id;
    createdProjectIds.push(projectId);

    const round = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(round.status, 200, `precondition: a reply to report on: ${JSON.stringify(round.json)}`);

    // A double click, or the client retrying a gateway timeout while the first
    // generation is still running. Which call wins is a legitimate race.
    const results = await Promise.all([
      api('POST', `/projects/${projectId}/generate-report`),
      api('POST', `/projects/${projectId}/generate-report`),
    ]);
    t.diagnostic(`statuses: ${results.map((r) => r.status).join(', ')}`);

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], 'exactly one generation runs; the other is refused, not queued');
    const loser = results.find((r) => r.status === 409);
    assert.match(loser.json.message, /already being generated/i);

    // recordUsage writes without awaiting; give the last rows a moment to land.
    await new Promise((r) => setTimeout(r, 1500));
    const [{ reports }] = await query(
      `SELECT count(*)::int AS reports FROM "LlmUsage" WHERE "projectId" = $1 AND scenario = 'discussion_report'`,
      [projectId],
    );
    const [{ audits }] = await query(
      `SELECT count(*)::int AS audits FROM "LlmUsage" WHERE "projectId" = $1 AND scenario = 'document_audit'`,
      [projectId],
    );
    const [{ sections }] = await query(
      'SELECT count(*)::int AS sections FROM "DocumentSection" WHERE "projectId" = $1',
      [projectId],
    );
    t.diagnostic(`discussion_report rows: ${reports}, document_audit rows: ${audits}, sections: ${sections}`);
    assert.equal(reports, 1, 'one discussion report call, as for a single generate-report');
    assert.ok(audits <= sections, `at most one audit call per section (${audits} for ${sections})`);

    // The guard is released when the winner finishes: the next call runs.
    const again = await api('POST', `/projects/${projectId}/generate-report`);
    assert.equal(again.status, 200, 'a sequential call after the first finished must not get a stale 409');
  });
});
