import { apiFetch } from './client';

/**
 * GET /api/projects/:projectId/rewrites
 * Returns RewritesDTO: the card, the brief and the full text (each null until
 * generated), each with the code's checks, its placeholders and `stale` when
 * the audience analysis was rerun after it.
 */
export function fetchRewrites(projectId) {
  return apiFetch(`/projects/${projectId}/rewrites`);
}

/**
 * POST /api/projects/:projectId/rewrites — all three versions; replaces the
 * set whole. 409 until the audience analysis exists. Not retried, like the
 * other LLM routes.
 */
export function runRewrites(projectId) {
  return apiFetch(`/projects/${projectId}/rewrites`, { method: 'POST', body: JSON.stringify({}) });
}

/** POST /api/projects/:projectId/rewrites/:layer — one version: card | brief | full. */
export function runRewriteLayer(projectId, layer) {
  return apiFetch(`/projects/${projectId}/rewrites/${layer}`, { method: 'POST', body: JSON.stringify({}) });
}
