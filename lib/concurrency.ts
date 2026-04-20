/**
 * Bounded-concurrency async map. Preserves input order. Safer than
 * Promise.all for LLM fan-out: OpenRouter rate-limits aggressively when a
 * single client fires 10+ requests in the same tick.
 *
 * Adopt `p-limit` if this grows teeth; for now a hand-rolled worker pool is
 * enough and one less dep to audit.
 */
export async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const tasks: Promise<void>[] = [];
  for (let w = 0; w < workers; w += 1) {
    tasks.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= items.length) return;
          results[i] = await mapper(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(tasks);
  return results;
}
