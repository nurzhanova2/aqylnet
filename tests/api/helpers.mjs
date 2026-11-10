export const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

export async function api(method, path, body, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, json };
}

export function randomSuffix() {
  return Math.random().toString(36).slice(2, 9);
}

// Minimal valid persona payload for CreatePersonaSchema.
export function personaPayload(overrides = {}) {
  return {
    name: `QA-Persona-${randomSuffix()}`,
    role: 'QA Test Role',
    gender: 'Мужской',
    age: '30 лет',
    dot: '#34d399',
    style: 'Аналитический',
    criticality: 'Средний',
    behaviorModel: 'Наблюдатель',
    ...overrides,
  };
}

export function projectPayload(personaIds, overrides = {}) {
  return {
    title: `QA-Project-${randomSuffix()}`,
    personaIds,
    documentText: 'Тестовый документ для автоматизированного тестирования банковского регулирования и его влияния на ставки по кредитам.',
    iterations: 2,
    moderator: true,
    goal: 'risk_search',
    ...overrides,
  };
}

// Cleanup helpers. They must not throw — an exception in after() would mask
// the result of the test that just ran — but they must not be silent either:
// swallowing every failure is how eleven QA personas and four stray projects
// accumulated in the live database without anyone noticing. 404 is normal
// (already gone); anything else is reported.
async function deleteAndReport(kind, path, id) {
  if (!id) return;
  try {
    const { status, json } = await api('DELETE', path);
    if (status !== 200 && status !== 404) {
      console.error(`[cleanup] ${kind} ${id} не удалён: ${status} ${JSON.stringify(json)}`);
    }
  } catch (err) {
    console.error(`[cleanup] ${kind} ${id}: ${err.message}`);
  }
}

export function deleteProjectSafe(id) {
  return deleteAndReport('проект', `/projects/${id}`, id);
}

export function deletePersonaSafe(id) {
  return deleteAndReport('персона', `/personas/${id}`, id);
}
