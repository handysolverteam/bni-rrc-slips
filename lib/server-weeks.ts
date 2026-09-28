import { createTtlCache } from "./cache";
import { getSupabaseServer } from "./supabase/server";
import type { WeekOption } from "./weeks";

// The week calendar changes only on import: cache per process for 5 minutes.
const cache = createTtlCache<WeekOption[]>(5 * 60 * 1000);

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

export const clearWeekOptionsCache = (): void => cache.clear();
