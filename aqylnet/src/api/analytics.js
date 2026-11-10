import { apiFetch } from './client';

/**
 * GET /api/projects/:projectId/analytics
 * Returns AnalyticsReportDTO (fat DTO: project meta + mood + all analytics data).
 * Returns empty arrays for analytics fields if no report exists yet.
 */
export function fetchAnalytics(projectId) {
  return apiFetch(`/projects/${projectId}/analytics`);
}
