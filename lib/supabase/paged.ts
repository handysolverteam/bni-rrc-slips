import { getSupabaseServer } from "./server";

/** PostgREST `max-rows` on this project: one response never exceeds this. */
const SERVER_MAX_ROWS = 1000;

/**
 * Fetch every row of a query. Supabase silently clamps any single response to
 * its server max-rows (1000 on this project), so one `.limit(20000)` still
 * returns 1000 — range-paging is the only correct way to read a whole table.
 * Throws on error (callers decide fallback).
 *
 * Speed: every request to the hosted database costs a full network round trip
 * (~350–650ms from here), so paging one page after another made a 3 000-row
 * table take ~1.5s. The FIRST page asks for the exact row count; every
 * remaining page is then requested in parallel — the whole table costs two
 * round trips however large it is. Order is preserved (pages are joined by
 * index). A response without a count falls back to sequential paging.
 */
export async function fetchAllRows<T>(
  table: string,
  columns: string,
  opts: {
    eq?: [string, unknown][];
    in?: [string, string[]][];
    order?: { column: string; ascending?: boolean };
    pageSize?: number;
  } = {},
): Promise<T[]> {
  const sb = getSupabaseServer();
  // A pageSize above max-rows is fatal: the response comes back truncated to
  // 1000, rows.length < pageSize looks like the last page, and pagination
  // stops early — silently losing data. Clamp to the server cap instead.
  const pageSize = Math.min(opts.pageSize ?? SERVER_MAX_ROWS, SERVER_MAX_ROWS);

  async function page(from: number, withCount: boolean): Promise<{ rows: T[]; count: number | null }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = withCount ? sb.from(table).select(columns, { count: "exact" }) : sb.from(table).select(columns);
    for (const [c, v] of opts.eq ?? []) q = q.eq(c, v);
    for (const [c, v] of opts.in ?? []) q = q.in(c, v);
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    return { rows: (data ?? []) as T[], count: typeof count === "number" ? count : null };
  }

  const first = await page(0, true);
  if (first.rows.length < pageSize) return first.rows;

  if (first.count !== null) {
    const pages = Math.ceil(first.count / pageSize);
    if (pages <= 1) return first.rows;
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page((i + 1) * pageSize, false)));
    return [first.rows, ...rest.map((r) => r.rows)].flat();
  }

  // No count available: sequential fallback.
  const out = [...first.rows];
  for (let from = pageSize; ; from += pageSize) {
    const { rows } = await page(from, false);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
