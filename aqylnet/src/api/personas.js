import { apiFetch } from './client';

/** GET /api/personas — PersonaDTO[] sorted by avatarIdx */
export function fetchPersonas() {
  return apiFetch('/personas');
}

/** POST /api/personas — create a new persona, returns PersonaDTO */
export function createPersona(data) {
  return apiFetch('/personas', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** PATCH /api/personas/:id — partial update, returns PersonaDTO */
export function updatePersona(id, data) {
  return apiFetch(`/personas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** DELETE /api/personas/:id */
export function deletePersona(id) {
  return apiFetch(`/personas/${id}`, { method: 'DELETE' });
}
