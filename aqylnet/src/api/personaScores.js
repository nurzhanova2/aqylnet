import { apiFetch } from './client';

/**
 * GET /api/projects/:projectId/persona-scores
 * Returns PersonaScoresDTO: hasScores, criteria, sections, personas (with their
 * per-section answers and document scores) and stats computed on the server
 * (document and section cells, top divergences, "не понял" shares, quotes).
 */
export function fetchPersonaScores(projectId) {
  return apiFetch(`/projects/${projectId}/persona-scores`);
}

/**
 * POST /api/projects/:projectId/persona-scores
 * Every persona of the project scores the document section by section, on its
 * own and apart from the discussion. Replaces the project's scores whole.
 * One LLM call per persona — not retried, like the other LLM routes.
 * Returns PersonaScoresDTO.
 */
export function runPersonaScores(projectId) {
  return apiFetch(`/projects/${projectId}/persona-scores`, { method: 'POST', body: JSON.stringify({}) });
}
