import { apiFetch } from './client';

/**
 * GET /api/projects/:projectId/audience-analysis
 * Returns AudienceAnalysisDTO: group levels, the gap against the intended
 * audience and the unclear terms per group — computed on the server on every
 * read — and `analysis` (the decision reference, verdicts, missing
 * explanations) once POST has run; `analysis.stale` when the persona scores
 * were rerun after it.
 */
export function fetchAudienceAnalysis(projectId) {
  return apiFetch(`/projects/${projectId}/audience-analysis`);
}

/**
 * POST /api/projects/:projectId/audience-analysis
 * Up to five LLM calls over the stored persona scores; 409 until they exist.
 * Replaces the project's analysis whole. Not retried, like the other LLM
 * routes. Returns AudienceAnalysisDTO.
 */
export function runAudienceAnalysis(projectId) {
  return apiFetch(`/projects/${projectId}/audience-analysis`, { method: 'POST', body: JSON.stringify({}) });
}
