import { fetchAllRows } from "@/lib/supabase/paged";

/** Distinct non-empty values of one text column, sorted for dropdowns. */
export async function distinctValues(
  table: string,
  column: string,
): Promise<string[]> {
  const data = await fetchAllRows<Record<string, unknown>>(table, column);
  const set = new Set<string>();
  for (const r of data) {
    const v = String(r[column] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Merge several distinct lists into one sorted unique list. */
export function mergeDistinct(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
}
