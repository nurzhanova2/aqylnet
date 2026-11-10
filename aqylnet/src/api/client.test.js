import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiFetch } from './client';

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch retries', () => {
  test('retries an explicitly allowed transient 404', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(404, {
        success: false, message: 'Project with id 7 not found',
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        success: true, data: { id: 7 },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/projects/7', {
      retry: 1,
      retryStatuses: [404],
      retryDelayMs: 0,
    })).resolves.toEqual({ id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('exposes status when retries are exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, {
      success: false, message: 'Project not found',
    })));

    await expect(apiFetch('/projects/7')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      path: '/projects/7',
    });
  });
});
