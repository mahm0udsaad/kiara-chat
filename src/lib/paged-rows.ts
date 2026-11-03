import "server-only";

const DAY_MS = 86_400_000;

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Read every row of a time window by splitting it into one-day slices and
 * fetching several slices at once. PostgREST hands back 1,000 rows a page, and
 * a month of Kiara messages is ~80 pages: read one after another that took
 * over 20 seconds and the phone gave up on the report.
 *
 * `load` gets a half-open slice — filter it with `.gte(col, start)` and
 * `.lt(col, end)` — and the page bounds for `.range()`. Rows come back in slice
 * order, so a query ordered by the window column stays ordered overall.
 */
export async function pageRowsByDay<T>(
  startMs: number,
  endExclusiveMs: number,
  load: (sliceStart: string, sliceEnd: string, from: number, to: number) => PageResult,
  { pageSize = 1_000, concurrency = 6 }: { pageSize?: number; concurrency?: number } = {},
): Promise<T[]> {
  const slices: [string, string][] = [];
  for (let at = startMs; at < endExclusiveMs; at += DAY_MS) {
    slices.push([
      new Date(at).toISOString(),
      new Date(Math.min(at + DAY_MS, endExclusiveMs)).toISOString(),
    ]);
  }

  const results: T[][] = new Array(slices.length);
  let next = 0;
  const worker = async () => {
    while (next < slices.length) {
      const index = next++;
      const [sliceStart, sliceEnd] = slices[index]!;
      const rows: T[] = [];
      for (let from = 0; ; from += pageSize) {
        const result = await load(sliceStart, sliceEnd, from, from + pageSize - 1);
        if (result.error) throw new Error(result.error.message);
        const page = (result.data ?? []) as T[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      results[index] = rows;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, slices.length) }, worker));
  return results.flat();
}

/**
 * Look rows up by a list of ids, a slice of ids at a time. The ids travel in
 * the request URL, and past a few hundred UUIDs PostgREST answers "Bad
 * Request": a month's 700 orders broke the orders report that way. 150 ids is
 * about 5.5 KB of URL.
 */
export async function rowsByIdChunks<T>(
  ids: readonly string[],
  load: (ids: string[]) => PageResult,
  { chunkSize = 150, concurrency = 4 }: { chunkSize?: number; concurrency?: number } = {},
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let at = 0; at < ids.length; at += chunkSize) chunks.push(ids.slice(at, at + chunkSize));

  const results: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      const result = await load(chunks[index]!);
      if (result.error) throw new Error(result.error.message);
      results[index] = (result.data ?? []) as T[];
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results.flat();
}
