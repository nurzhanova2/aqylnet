import { apiFetch } from './client';

/**
 * GET /api/projects/:projectId/timeline
 * Returns TimelineMessageDTO[] ordered by n.
 */
export function fetchTimeline(projectId) {
  return apiFetch(`/projects/${projectId}/timeline`);
}

/**
 * PATCH /api/projects/:projectId/timeline/:messageId
 * Edits a moderator question before the next round. Returns the updated
 * TimelineMessageDTO.
 */
export function updateModeratorMessage(projectId, messageId, text) {
  return apiFetch('/projects/' + projectId + '/timeline/' + messageId, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

/**
 * GET /api/projects/:projectId/summary
 * Returns DiscussionSummaryDTO or null if not yet created.
 */
export function fetchSummary(projectId) {
  return apiFetch(`/projects/${projectId}/summary`);
}
