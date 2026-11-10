// Stage E4 of .ai/SECURITY.md: the LLM pipeline's resilience and cost.
//
// These tests drive the real model, so they are slow and they spend tokens.
// Each project is created with two short personas and two rounds to keep that
// spend at the minimum that still proves the behaviour.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe,
} from '../api/helpers.mjs';
import { query } from '../api/db.mjs';

const personas = [];
const projects = [];

after(async () => {
  for (const id of projects) await deleteProjectSafe(id);
  for (const id of personas) await deletePersonaSafe(id);
});

async function makeProject(overrides = {}) {
  const p = await api('POST', '/personas', personaPayload({ responseLength: 'Краткий' }));
  assert.equal(p.status, 201, `persona setup failed: ${JSON.stringify(p.json)}`);
  personas.push(p.json.data.id);

  const proj = await api('POST', '/projects', projectPayload([p.json.data.id], {
    iterations: 3, moderator: true, ...overrides,
  }));
  assert.equal(proj.status, 201, `project setup failed: ${JSON.stringify(proj.json)}`);
  projects.push(proj.json.data.id);
  return proj.json.data.id;
}

describe('E4 item 10: rounds no longer monopolise the connection pool', () => {
  test('four rounds on different projects run together while the API stays responsive', async (t) => {
    // The coupling being tested: a round holds one pooled connection for its
    // whole duration. Unbounded, enough concurrent rounds exhausted the pool
    // and unrelated requests failed with P2024 after a ten-second stall.
    // Measured pool on the container: 49.
    const ids = await Promise.all([makeProject(), makeProject(), makeProject(), makeProject()]);

    const rounds = ids.map((id) => api('POST', `/projects/${id}/run-iteration`));

    // /api/health touches no database, so it proves the event loop is free;
    // GET /projects needs a pooled connection, so it proves the pool is.
    const healthTimings = [];
    const listTimings = [];
    for (let i = 0; i < 6; i++) {
      let started = Date.now();
      const health = await api('GET', '/health');
      healthTimings.push(Date.now() - started);
      assert.equal(health.status, 200, 'health must answer while rounds run');

      started = Date.now();
      const list = await api('GET', '/projects');
      listTimings.push(Date.now() - started);
      assert.equal(list.status, 200, 'a pooled query must answer while rounds run');
    }

    const results = await Promise.all(rounds);
    t.diagnostic(`round statuses: ${results.map((r) => r.status).join(', ')}`);
    t.diagnostic(`health ms: ${healthTimings.join(', ')} | /projects ms: ${listTimings.join(', ')}`);

    for (const r of results) {
      assert.equal(r.status, 200, `each round on its own project should succeed: ${JSON.stringify(r.json)}`);
    }

    // The old failure mode was a full pool_timeout wait (10s) ending in a 500.
    const worstList = Math.max(...listTimings);
    assert.ok(worstList < 5_000, `a pooled query took ${worstList}ms — the pool was starved`);
  });
});

describe('E4 item 17: token usage is recorded', () => {
  test('a round writes one usage row per completion, attributed to the project', async (t) => {
    const projectId = await makeProject();

    const before = await query(
      'SELECT count(*)::int AS n FROM "LlmUsage" WHERE "projectId" = $1',
      [projectId],
    );

    const round = await api('POST', `/projects/${projectId}/run-iteration`);
    assert.equal(round.status, 200, JSON.stringify(round.json));

    const rows = await query(
      `SELECT scenario, "promptTokens", "completionTokens", "totalTokens"
         FROM "LlmUsage" WHERE "projectId" = $1`,
      [projectId],
    );
    t.diagnostic(`usage rows: ${JSON.stringify(rows)}`);

    assert.ok(rows.length > before[0].n, 'the round must have been accounted for');
    for (const r of rows) {
      assert.ok(r.totalTokens > 0, 'a recorded row with zero tokens is noise, not accounting');
      assert.ok(
        ['persona_response', 'moderator_message', 'persona_positions'].includes(r.scenario),
        `unexpected scenario ${r.scenario}`,
      );
    }

    // The point of the table: the spend of one project is answerable.
    const total = rows.reduce((s, r) => s + r.totalTokens, 0);
    t.diagnostic(`project ${projectId} spent ${total} tokens`);
    assert.ok(total > 0);
  });

  test('the per-document persona positions are recorded with no project attached', async () => {
    // They are computed before the project row exists, so projectId is null —
    // and the spend must still be visible.
    const rows = await query(
      `SELECT count(*)::int AS n FROM "LlmUsage"
        WHERE scenario = 'persona_positions' AND "projectId" IS NULL`,
    );
    assert.ok(rows[0].n > 0, 'position calls should be accounted for even without a project');
  });
});

describe('E4 item 22: model output is validated before it becomes state', () => {
  test('every stored stance override is one of the four allowed values', async () => {
    // generatePersonaDocumentPositions used to be a bare cast, so whatever the
    // model produced landed in ProjectPersona.stanceOverride verbatim.
    const projectId = await makeProject();
    const rows = await query(
      'SELECT "stanceOverride" FROM "ProjectPersona" WHERE "projectId" = $1',
      [projectId],
    );
    const allowed = new Set(['Поддерживает', 'Против', 'Нейтральный', 'Неопределившийся']);
    for (const r of rows) {
      if (r.stanceOverride === null) continue;
      assert.ok(
        allowed.has(r.stanceOverride),
        `stored stance "${r.stanceOverride}" is not one of the four allowed values`,
      );
    }
  });
});
