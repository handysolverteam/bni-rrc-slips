import { createTtlCache, sharedState } from "./cache";
import { fetchAllRows } from "@/lib/supabase/paged";

type ListCache = ReturnType<typeof createTtlCache<string[]>>;

// Distinct values power the column-filter dropdowns. They change only on
// import, and computing one downloads the whole column — cache per process
// for 5 minutes (import clears explicitly). Keyed by `table.column`.
// sharedState: the import ROUTE and the page RENDER are separate module
// graphs — without it, clearing from the route would miss the page's copy.
const caches = sharedState("distinct.caches", () => new Map<string, ListCache>());

function cacheFor(key: string): ListCache {
  let c = caches.get(key);
  if (!c) {
    c = createTtlCache<string[]>(5 * 60 * 1000);
    caches.set(key, c);
  }
  return c;
}

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
  return cacheFor(`${tenantId}:${table}.${column}${extra}`).get(async () => {
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

/** Drop all cached dropdown option lists (call on import). */
export function clearDistinctCache(): void {
  for (const c of caches.values()) c.clear();
}
