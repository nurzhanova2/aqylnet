/**
 * Maps `items` through `fn` with at most `limit` calls in flight, keeping the
 * order of results. For work that should share a resource politely — here, the
 * section audits of one report on a GPU every proxy user shares.
 *
 * `fn` is expected not to throw (the audit's generators never do); if it does,
 * the first rejection propagates, as with Promise.all.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
