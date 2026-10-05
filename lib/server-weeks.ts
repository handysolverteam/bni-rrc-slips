import { createTtlCache, sharedState } from "./cache";
import { latestImportedWeekId } from "./report-view";
import { getSupabaseServer } from "./supabase/server";
import { isoWeekNumber, type WeekOption } from "./weeks";

// Week options change only on import: cache per process for 5 minutes,
// keyed by tenant (sharedState keeps ONE instance across page and
// route-handler bundles).
type OptionCache = ReturnType<typeof createTtlCache<WeekOption[]>>;
const cache = sharedState("serverWeeks.optionsByTenant", () => new Map<string, OptionCache>());
// Default week = weeks list + import_batches scan; recompute only on import.
type DefaultCache = ReturnType<typeof createTtlCache<string | null>>;
const defaultCache = sharedState("serverWeeks.defaultByTenant", () => new Map<string, DefaultCache>());

function optionsCacheFor(tenantId: string): OptionCache {
  let c = cache.get(tenantId);
  if (!c) {
    c = createTtlCache<WeekOption[]>(5 * 60 * 1000);
    cache.set(tenantId, c);
  }
  return c;
}

function defaultCacheFor(tenantId: string): DefaultCache {
  let c = defaultCache.get(tenantId);
  if (!c) {
    c = createTtlCache<string | null>(5 * 60 * 1000);
    defaultCache.set(tenantId, c);
  }
  return c;
}

/** Weeks this tenant has imported data for (the shared calendar itself is global). */
async function fetchWeekOptions(tenantId: string): Promise<WeekOption[]> {
  const sb = getSupabaseServer();
  const { data: batches, error: batchError } = await sb
    .from("import_batches")
    .select("bni_week_id")
    .eq("tenant_id", tenantId)
    .not("bni_week_id", "is", null);
  if (batchError) throw new Error(batchError.message);
  const ids = [...new Set((batches ?? []).map((b) => b.bni_week_id as string))];
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("bni_weeks")
    .select("id,label,meeting_date,week_no")
    .in("id", ids)
    .order("week_no", { ascending: true, nullsFirst: false })
    .order("meeting_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as WeekOption[]).map((w, i) => ({ ...w, week_no: w.week_no ?? i + 1 }));
}

export const getCachedWeekOptions = (tenantId: string): Promise<WeekOption[]> =>
  optionsCacheFor(tenantId).get(() => fetchWeekOptions(tenantId));

/** Week id whose week number is closest to the current ISO week, among weeks
 *  this tenant has imported (ties prefer the past week). */
async function computeDefaultWeekId(tenantId: string): Promise<string | null> {
  const sb = getSupabaseServer();
  const { data: imported } = await sb
    .from("import_batches")
    .select("bni_week_id")
    .eq("tenant_id", tenantId)
    .not("bni_week_id", "is", null);
  const importedIds = new Set((imported ?? []).map((b) => b.bni_week_id as string));
  const weeks = (await getCachedWeekOptions(tenantId)).filter((w) => importedIds.has(w.id));
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

export const defaultWeekId = (tenantId: string): Promise<string | null> =>
  defaultCacheFor(tenantId).get(() => computeDefaultWeekId(tenantId));

export const clearWeekOptionsCache = (): void => {
  cache.clear();
  defaultCache.clear();
};

/**
 * Week scope for a list page. The header `c_bni_week` filter (one id or a
 * comma-separated multi-select) wins over the legacy `?week=` param (kept
 * for direct links); neither set falls back to the default (latest imported)
 * week. `weekFilter` is the value to show in the header column filter
 * ("all" | one id | comma-separated ids | "" when nothing resolves).
 */
export async function listWeekScope(
  tenantId: string,
  sp: Record<string, string | undefined>,
): Promise<{ weekId: string; weekFilter: string }> {
  const param = sp.c_bni_week ?? sp.week;
  if (param === "all") return { weekId: "", weekFilter: "all" };
  const ids = (param || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    const [d, l] = await Promise.all([defaultWeekId(tenantId), latestImportedWeekId(tenantId)]);
    return { weekId: d || l || "", weekFilter: d || l || "" };
  }
  return { weekId: ids.join(","), weekFilter: ids.join(",") };
}
