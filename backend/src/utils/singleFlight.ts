import { ConflictError } from './errors';

/**
 * At most one run per key at a time; a second concurrent run for the same key
 * is refused with 409 instead of being queued or duplicated.
 *
 * For the long LLM operations on a project (a round, the report, persona
 * scores, audience analysis, rewrites): a double click or a client retry on a
 * gateway timeout would otherwise start a second, equally expensive run while
 * the first is still spending tokens. Other keys are not affected.
 *
 * The check and the insert are adjacent with no await between them — `run` is
 * async, but its body executes synchronously up to the first await — so on a
 * single-threaded event loop two simultaneous calls cannot both see the key as
 * free. The key is released in `finally`, on success and on failure alike, so
 * a failed run does not block the next attempt.
 *
 * In-process by design, like utils/semaphore.ts: a second replica would need a
 * database-level guard (the round has one, an advisory lock).
 */
export function singleFlight(conflictMessage: (key: number) => string) {
  const inFlight = new Set<number>();
  return async function run<T>(key: number, fn: () => Promise<T>): Promise<T> {
    if (inFlight.has(key)) throw new ConflictError(conflictMessage(key));
    inFlight.add(key);
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  };
}
