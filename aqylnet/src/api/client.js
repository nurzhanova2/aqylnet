import { getSessionKey } from '../utils/sessionKey';

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(message, status, path) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches an API response and optionally retries explicitly allowed statuses.
 * Mutating operations must opt in only when they are known to be idempotent.
 */
export async function apiFetch(path, options = {}) {
  const { retry = 0, retryStatuses = [502, 503, 504],
    retryDelayMs = 250, ...fetchOptions } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(BASE_URL + path, {
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Key': getSessionKey(),
          ...fetchOptions.headers,
        },
        ...fetchOptions,
      });
      const json = (res.headers.get('content-type') ?? '').includes('application/json')
        ? await res.json() : null;

      if (!res.ok || !json?.success) {
        const error = new ApiError(
          json?.message ?? 'Request failed: ' + res.status, res.status, path,
        );
        if (attempt < retry && retryStatuses.includes(res.status)) {
          await wait(retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
      return json.data;
    } catch (error) {
      if (!(error instanceof ApiError) && attempt < retry) {
        await wait(retryDelayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Multipart upload wrapper. The browser supplies the multipart boundary.
 */
export async function apiFetchForm(path, formData) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    // Only the session key — the browser must set Content-Type itself so the
    // multipart boundary is generated.
    headers: { 'X-Session-Key': getSessionKey() },
    body: formData,
  });
  const json = (res.headers.get('content-type') ?? '').includes('application/json')
    ? await res.json() : null;

  if (!res.ok || !json?.success) {
    throw new ApiError(
      json?.message ?? 'Upload failed: ' + res.status, res.status, path,
    );
  }
  return json.data;
}
