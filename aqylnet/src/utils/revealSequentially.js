// Reveals a batch of newly-generated messages one at a time, so a discussion
// round doesn't dump every persona's reply on screen in the same instant.
//
// Deliberately NOT a backend concern: the LLM calls and the BUG-4
// transaction-scoped lock already finished by the time this runs — this is
// pure frontend presentation timing over data the backend already returned.
export const PERSONA_RESPONSE_DELAY_MS = 5000;

/**
 * @param {Array<T>} items - messages to reveal, in the order they should appear.
 * @param {object} options
 * @param {number} [options.delayMs] - gap between reveals. The FIRST item is
 *   always delivered immediately (no delay before it).
 * @param {(item: T, index: number) => void} [options.onReveal] - called once
 *   per item, in order, as it becomes visible.
 * @param {() => void} [options.onComplete] - called once after the last item
 *   has been revealed. Called synchronously (no items) if `items` is empty.
 * @returns {() => void} cancel - stops any further scheduled reveals. Safe to
 *   call multiple times. Already-revealed items are not retracted; onComplete
 *   is not called if cancelled before the sequence finished.
 */
export function revealSequentially(items, options = {}) {
  const { delayMs = PERSONA_RESPONSE_DELAY_MS, onReveal, onComplete } = options;
  let cancelled = false;
  let timer = null;

  if (!items || items.length === 0) {
    onComplete?.();
    return () => { cancelled = true; };
  }

  function revealAt(index) {
    if (cancelled) return;
    onReveal?.(items[index], index);
    if (index === items.length - 1) {
      onComplete?.();
      return;
    }
    timer = setTimeout(() => revealAt(index + 1), delayMs);
  }

  revealAt(0);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
