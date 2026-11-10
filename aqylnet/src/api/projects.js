import { apiFetch } from './client';

/**
 * GET /api/projects
 * Returns ProjectListDTO[]
 */
export function fetchProjects() {
  return apiFetch('/projects', { retry: 2 });
}

/**
 * GET /api/projects/:id
 * Returns ProjectDetailDTO
 */
export function fetchProject(id) {
  // 404 is deliberately not retried. It is not a transient condition here:
  // the backend returns it for a project that belongs to another workspace
  // key, so retrying only repeats a question already answered.
  return apiFetch('/projects/' + id, {
    retry: 3,
    retryStatuses: [502, 503, 504],
  });
}

/**
 * POST /api/projects
 * @param {{ title: string, personaIds: number[], personaStances?: Record<number, string>,
 *           iterations?: number, moderator?: boolean, mode?: string, goal?: string,
 *           intendedMessages?: string[], documentText?: string, documentFile?: string }} data
 * Returns ProjectDetailDTO
 */
export function createProject(data) {
  return apiFetch('/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * PATCH /api/projects/:id
 * @param {number} id
 * @param {{ title?: string, subtitle?: string, mode?: string, iterations?: number,
 *           moderator?: boolean, goal?: string, intendedMessages?: string[] }} data
 * `status` and `currentIteration` are owned by the round transaction and
 * `llmModel` by the server (SECURITY.md item 28) — all three are stripped from
 * the body, so sending them has no effect.
 * Returns ProjectDetailDTO
 */
export function updateProject(id, data) {
  return apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * DELETE /api/projects/:id
 */
export function deleteProject(id) {
  return apiFetch(`/projects/${id}`, { method: 'DELETE' });
}

/**
 * POST /api/projects/:id/personas
 * Adds an existing library persona to an already-created project.
 * @param {number} projectId
 * @param {number} personaId
 * @param {string} [stance] - per-discussion stance override
 * Returns PersonaDTO[] — full updated persona list for the project
 */
export function addPersonaToProject(projectId, personaId, stance) {
  return apiFetch(`/projects/${projectId}/personas`, {
    method: 'POST',
    body: JSON.stringify({ personaId, ...(stance && { stance }) }),
  });
}

/**
 * DELETE /api/projects/:id/personas/:personaId
 * Returns PersonaDTO[] — full updated persona list for the project
 */
export function removePersonaFromProject(projectId, personaId) {
  return apiFetch(`/projects/${projectId}/personas/${personaId}`, { method: 'DELETE' });
}

/**
 * POST /api/suggest/personas
 * Asks LLM to pick count personas relevant to the document.
 * @param {string} documentText
 * @param {number} count
 * @returns {{ personaIds: number[] }}
 */
export function suggestPersonas(documentText, count = 8) {
  return apiFetch('/suggest/personas', {
    method: 'POST',
    body: JSON.stringify({ documentText, count }),
  });
}

/**
 * POST /api/projects/:id/run-iteration
 * Triggers one LLM iteration: generates persona replies and saves them.
 * @param {number} projectId
 * @returns {IterationResultDTO} { currentIteration, status, messages }
 */
export function runIteration(projectId) {
  return apiFetch(`/projects/${projectId}/run-iteration`, { method: 'POST' });
}

/**
 * POST /api/projects/:id/generate-report
 * LLM reads the full discussion timeline and generates the final summary +
 * analytics report (mood, conclusions, risks, recommendations, etc).
 * @param {number} projectId
 * @returns {AnalyticsReportDTO}
 */
export function generateReport(projectId) {
  // Not retried. The report is the discussion report plus a section-by-section
  // audit and runs for minutes; a gateway 504 arrives while the backend is
  // still generating, so a retry started a second, equally expensive run. The
  // backend now refuses a concurrent second run with 409 (isReportInProgress).
  return apiFetch('/projects/' + projectId + '/generate-report', { method: 'POST' });
}

/** Shown instead of an error when a report for this project is already being generated. */
export const REPORT_IN_PROGRESS = 'Отчёт уже формируется — он появится здесь, когда генерация закончится.';

/** The 409 from generate-report: another generation for this project is still running. */
export function isReportInProgress(err) {
  return err?.status === 409;
}
