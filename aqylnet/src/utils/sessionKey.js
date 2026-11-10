const STORAGE_KEY = 'aqylnet.sessionKey';

// Falls back to an in-memory key when localStorage is unavailable (private
// browsing modes throw on access rather than returning null). The workspace
// then lives for the lifetime of the tab instead of the device — degraded,
// but the app keeps working rather than crashing on first render.
let memoryKey = null;

function randomKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Older WebViews: not cryptographically strong, but this key only separates
  // workspaces, it does not protect anything.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Opaque per-device workspace key, created once and reused.
 * Scopes which simulations this browser sees — it is not authentication.
 */
export function getSessionKey() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const fresh = randomKey();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    memoryKey ??= randomKey();
    return memoryKey;
  }
}
