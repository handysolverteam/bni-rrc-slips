import { getSupabaseServer } from "@/lib/supabase/server";
import { buildWeekLabel } from "@/lib/weeks";
import { missingWednesdays, todayIso } from "@/lib/missing-weeks";

export { missingWednesdays, todayIso };
export type MissingFile = { date: string; label: string };

/**
 * Wednesdays between the tenant's first imported meeting and today with no
 * imported slips file — the "missing meeting file" warning on `/report` and
 * `/summary` (date math lives in `lib/missing-weeks.ts`, unit-tested there).
 */
export async function fetchMissingMeetingFiles(
  tenantId: string,
  today: string = todayIso(),
): Promise<MissingFile[]> {
  const sb = getSupabaseServer();
  const [batchesRes, weeksRes] = await Promise.all([
    sb.from("import_batches").select("bni_week_id").eq("tenant_id", tenantId).not("bni_week_id", "is", null),
    sb.from("bni_weeks").select("id,meeting_date").not("meeting_date", "is", null).limit(400),
  ]);
  if (batchesRes.error) throw new Error(batchesRes.error.message);
  if (weeksRes.error) throw new Error(weeksRes.error.message);
  const importedIds = new Set((batchesRes.data ?? []).map((b) => b.bni_week_id as string));
  const importedDates = (weeksRes.data ?? [])
    .filter((w) => importedIds.has(w.id))
    .map((w) => w.meeting_date as string)
    .filter(Boolean);
  return missingWednesdays(importedDates, today).map((date) => ({
    date,
    label: buildWeekLabel(date),
  }));
}
