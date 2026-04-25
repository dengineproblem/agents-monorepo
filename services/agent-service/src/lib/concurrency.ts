/**
 * Утилита для ограничения параллельной обработки массива.
 * Запускает не более `limit` задач одновременно. Сохраняет порядок результатов.
 *
 * Используется для throttling запросов к Facebook Marketing API
 * чтобы не упираться в rate limits при работе с многими аккаунтами.
 */
export async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: effectiveLimit }, () => worker());
  await Promise.all(workers);
  return results;
}
