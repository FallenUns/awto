export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit <= 0) throw new Error("concurrency limit must be positive");
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length || firstError) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        if (!firstError) firstError = err;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}
