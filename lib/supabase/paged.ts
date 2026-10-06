import { getSupabaseServer } from "./server";

/** PostgREST `max-rows` on this project: one response never exceeds this. */
const SERVER_MAX_ROWS = 1000;

/**
 * Fetch every row of a query, page by page. Supabase silently clamps any
 * single response to its server max-rows (1000 on this project), so one
 * `.limit(20000)` still returns 1000 — range-paging is the only correct
 * way to read a whole table. Throws on error (callers decide fallback).
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
  const out: T[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from(table).select(columns);
    for (const [c, v] of opts.eq ?? []) q = q.eq(c, v);
    for (const [c, v] of opts.in ?? []) q = q.in(c, v);
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = ((data ?? []) as T[]);
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
