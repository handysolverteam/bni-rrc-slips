import { createTtlCache } from "./cache";
import { fetchAllRows } from "@/lib/supabase/paged";

type ListCache = ReturnType<typeof createTtlCache<string[]>>;

// Distinct values power the column-filter dropdowns. They change only on
// import, and computing one downloads the whole column — cache per process
// for 5 minutes (import clears explicitly). Keyed by `table.column`.
const caches = new Map<string, ListCache>();

function cacheFor(key: string): ListCache {
  let c = caches.get(key);
  if (!c) {
    c = createTtlCache<string[]>(5 * 60 * 1000);
    caches.set(key, c);
  }
  return c;
}

/** Distinct non-empty values of one text column, sorted for dropdowns. */
export async function distinctValues(
  table: string,
  column: string,
): Promise<string[]> {
  return cacheFor(`${table}.${column}`).get(async () => {
    const data = await fetchAllRows<Record<string, unknown>>(table, column);
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
