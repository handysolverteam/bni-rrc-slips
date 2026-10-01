import { createTtlCache, sharedState } from "./cache";
import { latestImportedWeekId } from "./report-view";
import { getSupabaseServer } from "./supabase/server";
import { isoWeekNumber, type WeekOption } from "./weeks";

// The week calendar changes only on import: cache per process for 5 minutes.
// sharedState keeps ONE instance across page and route-handler bundles.
const cache = sharedState("serverWeeks.options", () => createTtlCache<WeekOption[]>(5 * 60 * 1000));
// Default week = weeks list + import_batches scan; recompute only on import.
const defaultCache = sharedState("serverWeeks.default", () => createTtlCache<string | null>(5 * 60 * 1000));

async function fetchWeekOptions(): Promise<WeekOption[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("bni_weeks")
    .select("id,label,meeting_date,week_no")
    .order("week_no", { ascending: true, nullsFirst: false })
    .order("meeting_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as WeekOption[]).map((w, i) => ({ ...w, week_no: w.week_no ?? i + 1 }));
}

export const getCachedWeekOptions = (): Promise<WeekOption[]> => cache.get(fetchWeekOptions);

/** Week id whose week number is closest to the current ISO week, among weeks
 *  that have imported data (ties prefer the past week). */
async function computeDefaultWeekId(): Promise<string | null> {
  const sb = getSupabaseServer();
  const { data: imported } = await sb
    .from("import_batches")
    .select("bni_week_id")
    .not("bni_week_id", "is", null);
  const importedIds = new Set((imported ?? []).map((b) => b.bni_week_id as string));
  const weeks = (await getCachedWeekOptions()).filter((w) => importedIds.has(w.id));
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const currentWeek = isoWeekNumber(todayIso);
  if (currentWeek == null) return null;
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const w of weeks) {
    const weekNo = w.meeting_date ? isoWeekNumber(w.meeting_date) : (w.week_no ?? null);
    if (weekNo == null) continue;
    const diff = Math.abs(weekNo - currentWeek);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = w.id;
    }
  }
  return best;
}

export const defaultWeekId = (): Promise<string | null> =>
  defaultCache.get(computeDefaultWeekId);

export const clearWeekOptionsCache = (): void => {
  cache.clear();
  defaultCache.clear();
};

/**
 * Week scope for a list page. The header `c_bni_week` filter wins over the
 * legacy `?week=` param (kept for direct links); neither set falls back to
 * the default (latest imported) week. `weekFilter` is the value to show in
 * the header column filter ("all" | week id | "" when nothing resolves).
 */
export async function listWeekScope(
  sp: Record<string, string | undefined>,
): Promise<{ weekId: string; weekFilter: string }> {
  const param = sp.c_bni_week ?? sp.week;
  if (param === "all") return { weekId: "", weekFilter: "all" };
  let weekId = param || "";
  if (!weekId) {
    const [d, l] = await Promise.all([defaultWeekId(), latestImportedWeekId()]);
    weekId = d || l || "";
  }
  return { weekId, weekFilter: weekId };
}
