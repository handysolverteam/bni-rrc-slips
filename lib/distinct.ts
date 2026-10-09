import { cachedSwr, clearCached } from "./cache";
import { fetchAllRows } from "@/lib/supabase/paged";

// Distinct values power the column-filter dropdowns. They change only on
// import, and computing one downloads the whole column — so each list is cached
// per tenant + column, fresh for 5 minutes and then served stale while it
// refreshes in the background (a dropdown never waits for the database after
// the first load). Every write path calls clearDistinctCache(); the shared
// cache lives in lib/cache.ts (one copy across page and route-handler bundles).

/** Distinct non-empty values of one text column, sorted for dropdowns.
 *  Scoped to the tenant (cache key includes the tenant id). Extra `eq`
 *  filters narrow the source rows (e.g. active-only members). */
export async function distinctValues(
  tenantId: string,
  table: string,
  column: string,
  extraEq: [string, unknown][] = [],
): Promise<string[]> {
  const extra = extraEq.length
    ? `|${extraEq.map(([k, v]) => `${k}=${String(v)}`).join("|")}`
    : "";
  return cachedSwr(`distinct:${tenantId}:${table}.${column}${extra}`, 5 * 60_000, async () => {
    const data = await fetchAllRows<Record<string, unknown>>(table, column, {
      eq: [["tenant_id", tenantId], ...extraEq],
    });
    const set = new Set<string>();
    for (const r of data) {
      const v = String(r[column] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });
}

/** Merge several distinct lists into one sorted unique list. */
export function mergeDistinct(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
}

/** Drop every cached list — dropdown options AND the dashboard / Attendance / Top 3
 *  data caches (call on every write: import, merge, member toggle, settings). */
export function clearDistinctCache(): void {
  clearCached();
}
