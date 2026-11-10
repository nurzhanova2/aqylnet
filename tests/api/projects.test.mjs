import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, personaPayload, projectPayload, deletePersonaSafe, deleteProjectSafe } from './helpers.mjs';

const createdPersonaIds = [];
const createdProjectIds = [];
after(async () => {
  for (const id of createdProjectIds) await deleteProjectSafe(id);
  for (const id of createdPersonaIds) await deletePersonaSafe(id);
});

async function makeTestPersona(overrides = {}) {
  const { json } = await api('POST', '/personas', personaPayload(overrides));
  createdPersonaIds.push(json.data.id);
  return json.data.id;
}

describe('Projects API', () => {
  test('GET /projects returns list with personaCount', async () => {
    const { status, json } = await api('GET', '/projects');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.data));
    if (json.data.length > 0) assert.ok('personaCount' in json.data[0]);
  });

  test('POST /projects with zero personas succeeds (schema allows empty personaIds)', async () => {
    const { status, json } = await api('POST', '/projects', projectPayload([]));
    assert.equal(status, 201);
    createdProjectIds.push(json.data.id);
    assert.equal(json.data.personas.length, 0);
    assert.equal(json.data.status, 'setup');
  });

  test('POST /projects with an unknown personaId returns 404, not 400', async () => {
    const { status, json } = await api('POST', '/projects', projectPayload([999999999]));
    assert.equal(status, 404);
    assert.match(json.message, /Persona with id 999999999/);
  });

  test('POST /projects rejects iterations above schema max (10)', async () => {
    const pid = await makeTestPersona();
    const { status } = await api('POST', '/projects', projectPayload([pid], { iterations: 11 }));
    assert.equal(status, 400);
  });

  test('POST /projects rejects iterations of 0 (schema min is 1)', async () => {
    const pid = await makeTestPersona();
    const { status } = await api('POST', '/projects', projectPayload([pid], { iterations: 0 }));
    assert.equal(status, 400);
  });

  test('POST /projects rejects an invalid goal enum value', async () => {
    const pid = await makeTestPersona();
    const { status } = await api('POST', '/projects', projectPayload([pid], { goal: 'not_a_real_goal' }));
    assert.equal(status, 400);
  });

  test('POST /projects rejects empty title', async () => {
    const pid = await makeTestPersona();
    const { status } = await api('POST', '/projects', projectPayload([pid], { title: '' }));
    assert.equal(status, 400);
  });

  test('POST /projects with personaStances applies a per-project stanceOverride that differs from the persona library default', async () => {
    const pid = await makeTestPersona({ stance: 'Поддерживает' });
    const { status, json } = await api('POST', '/projects', projectPayload([pid], {
      personaStances: { [String(pid)]: 'Против' },
    }));
    assert.equal(status, 201);
    createdProjectIds.push(json.data.id);
    const inProject = json.data.personas.find((p) => p.id === pid);
    assert.equal(inProject.stance, 'Против', 'project-level stance override must win over the persona library default');

    // Confirm the library persona itself is untouched.
    const { json: libraryPersona } = await api('GET', `/personas/${pid}`);
    assert.equal(libraryPersona.data.stance, 'Поддерживает', 'library persona stance must not be mutated by a project override');
  });

  test('GET /projects/:id returns 404 for a non-existent project', async () => {
    const { status } = await api('GET', '/projects/999999999');
    assert.equal(status, 404);
  });

  // These two tests previously asserted the opposite: that PATCH could set
  // `status` and `currentIteration` freely, the second one even labelled as a
  // documented "business-rule gap". That gap was the vulnerability — resetting
  // the counter lifted the round limit and with it any bound on LLM spend for
  // that project (SECURITY.md item 13). Both fields are now absent from
  // UpdateProjectSchema and belong solely to the round transaction in
  // iteration.service, which advances the counter only after a whole round is
  // written.
  test('PATCH /projects/:id ignores lifecycle fields — status and currentIteration are not client-settable', async () => {
    const pid = await makeTestPersona();
    const { json: created } = await api('POST', '/projects', projectPayload([pid]));
    createdProjectIds.push(created.data.id);

    const { status, json } = await api('PATCH', `/projects/${created.data.id}`, {
      currentIteration: 1, status: 'running', subtitle: 'edited by PATCH',
    });
    assert.equal(status, 200);
    // An editable field still goes through...
    assert.equal(json.data.subtitle, 'edited by PATCH');
    // ...while the lifecycle pair does not. Zod strips unknown keys, so the
    // request is accepted and the fields are simply dropped.
    assert.equal(json.data.currentIteration, created.data.currentIteration);
    assert.equal(json.data.status, created.data.status);
  });

  test('PATCH /projects/:id cannot advance currentIteration past the configured iterations cap', async () => {
    const pid = await makeTestPersona();
    const { json: created } = await api('POST', '/projects', projectPayload([pid], { iterations: 2 }));
    createdProjectIds.push(created.data.id);

    const { status, json } = await api('PATCH', `/projects/${created.data.id}`, { currentIteration: 999 });
    assert.equal(status, 200, 'unknown keys are stripped, not rejected');
    assert.equal(json.data.currentIteration, 0, 'the counter is owned by run-iteration, not by PATCH');
  });

  test('DELETE /projects/:id cascades — sub-resources become unreachable (404) afterward', async () => {
    const pid = await makeTestPersona();
    const { json: created } = await api('POST', '/projects', projectPayload([pid]));
    const projectId = created.data.id;

    const del = await api('DELETE', `/projects/${projectId}`);
    assert.equal(del.status, 200);

    const { status: getStatus } = await api('GET', `/projects/${projectId}`);
    assert.equal(getStatus, 404);
    const { status: timelineStatus } = await api('GET', `/projects/${projectId}/timeline`);
    assert.equal(timelineStatus, 404, 'timeline endpoint asserts project existence first');
  });

  describe('Persona sub-resource', () => {
    test('POST /projects/:id/personas adding a duplicate persona returns 409 Conflict', async () => {
      const pid = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([pid]));
      createdProjectIds.push(created.data.id);

      const { status, json } = await api('POST', `/projects/${created.data.id}/personas`, { personaId: pid });
      assert.equal(status, 409);
      assert.match(json.message, /already in project/);
    });

    test('POST /projects/:id/personas with unknown personaId returns 404', async () => {
      const pid = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([pid]));
      createdProjectIds.push(created.data.id);

      const { status } = await api('POST', `/projects/${created.data.id}/personas`, { personaId: 999999999 });
      assert.equal(status, 404);
    });

    test('DELETE /projects/:id/personas/:personaId on a persona not in the project returns 404', async () => {
      const pid = await makeTestPersona();
      const other = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([pid]));
      createdProjectIds.push(created.data.id);

      const { status } = await api('DELETE', `/projects/${created.data.id}/personas/${other}`);
      assert.equal(status, 404);
    });

    test('BUG-3 (fixed): DELETE /projects/:id/personas/:personaId rejects removing the last persona with 409, project composition unchanged', async () => {
      const pid = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([pid]));
      createdProjectIds.push(created.data.id);
      assert.equal(created.data.personas.length, 1, 'precondition: project has exactly one persona');

      const { status, json } = await api('DELETE', `/projects/${created.data.id}/personas/${pid}`);
      assert.equal(status, 409, 'FIXED: removing the last persona must be rejected, not silently accepted');
      assert.match(json.message, /last persona|no personas/i);

      const stillThere = await api('GET', `/projects/${created.data.id}/personas`);
      assert.equal(stillThere.status, 200);
      assert.equal(stillThere.json.data.length, 1, 'project must still have its one persona — no partial removal');
      assert.equal(stillThere.json.data[0].id, pid);
    });

    test('BUG-3 (fixed): a project with 2 personas allows removing one, then rejects removing the last one', async () => {
      const a = await makeTestPersona();
      const b = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([a, b]));
      createdProjectIds.push(created.data.id);
      assert.equal(created.data.personas.length, 2, 'precondition: project has exactly two personas');

      const first = await api('DELETE', `/projects/${created.data.id}/personas/${a}`);
      assert.equal(first.status, 200, 'removing one of two personas is still allowed');
      assert.equal(first.json.data.length, 1);

      const second = await api('DELETE', `/projects/${created.data.id}/personas/${b}`);
      assert.equal(second.status, 409, 'removing the now-last persona is rejected');

      const stillThere = await api('GET', `/projects/${created.data.id}/personas`);
      assert.equal(stillThere.json.data.length, 1, 'the remaining persona must still be in the project');
      assert.equal(stillThere.json.data[0].id, b);
    });

    test('BUG-3 (fixed, concurrency): two simultaneous DELETE calls on the last two personas leave exactly one persona in the project', async () => {
      // Guards against a plain count-then-delete TOCTOU race: fire both
      // removals at once and confirm the project never reaches zero personas
      // no matter which request "wins".
      const a = await makeTestPersona();
      const b = await makeTestPersona();
      const { json: created } = await api('POST', '/projects', projectPayload([a, b]));
      createdProjectIds.push(created.data.id);

      const [r1, r2] = await Promise.all([
        api('DELETE', `/projects/${created.data.id}/personas/${a}`),
        api('DELETE', `/projects/${created.data.id}/personas/${b}`),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409], 'exactly one removal must succeed and the other must be rejected');

      const remaining = await api('GET', `/projects/${created.data.id}/personas`);
      assert.equal(remaining.json.data.length, 1, 'project must never end up with zero personas, regardless of race outcome');
    });
  });
});
