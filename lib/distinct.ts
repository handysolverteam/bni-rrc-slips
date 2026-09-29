import { getSupabaseServer } from "@/lib/supabase/server";

/** Distinct non-empty values of one text column, sorted for dropdowns. */
export async function distinctValues(
  table: string,
  column: string,
  limit = 5000,
): Promise<string[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from(table).select(column).limit(limit);
  const set = new Set<string>();
  for (const r of ((data ?? []) as unknown as Record<string, unknown>[])) {
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
