import { getSupabaseServer } from "@/lib/supabase/server";
import { buildWeekLabel } from "@/lib/weeks";
import { missingWednesdays, todayIso } from "@/lib/missing-weeks";
import { fetchSlipTotalsByWeek } from "@/lib/palms-compare";
import { fetchAllRows } from "@/lib/supabase/paged";

export { missingWednesdays, todayIso };
export type MissingFile = { date: string; label: string };
/** One week in scope: which of the two files (slips / PALMS) is not imported yet. */
export type UnimportedEntry = { label: string; slips: boolean; palms: boolean };

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

/**
 * For the selected week scope: weeks still missing their Slips Audit Report
 * and/or their Chapter Summary PALMS — the red "… not imported yet" banner
 * on `/report` and `/summary`. Explicit scope = exactly those weeks; empty
 * scope (`all`) = every week the tenant imported anything for (a batch of
 * either type). Either file may be imported first, so both sides are checked.
 */
export async function fetchUnimportedData(
  tenantId: string,
  weekIds: string[],
): Promise<UnimportedEntry[]> {
  const sb = getSupabaseServer();
  let candidates: { id: string; label: string }[];
  if (weekIds.length > 0) {
    const { data, error } = await sb.from("bni_weeks").select("id,label").in("id", weekIds);
    if (error) throw new Error(error.message);
    candidates = (data ?? []) as { id: string; label: string }[];
  } else {
    const { data, error } = await sb
      .from("import_batches")
      .select("bni_week_id, bni_weeks(label)")
      .eq("tenant_id", tenantId)
      .not("bni_week_id", "is", null)
      .limit(500);
    if (error) throw new Error(error.message);
    const seen = new Map<string, string>();
    for (const b of (data ?? []) as {
      bni_week_id: string | null;
      bni_weeks: { label: string }[] | { label: string } | null;
    }[]) {
      // Depending on generated FK types the embed is either the row or [row].
      const rel = b.bni_weeks;
      const label = Array.isArray(rel) ? rel[0]?.label : rel?.label;
      if (b.bni_week_id && label && !seen.has(b.bni_week_id)) seen.set(b.bni_week_id, label);
    }
    candidates = [...seen].map(([id, label]) => ({ id, label }));
  }
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);

  const [slipTotals, attendance] = await Promise.all([
    fetchSlipTotalsByWeek(tenantId, ids),
    fetchAllRows<{ bni_week_id: string }>("member_attendance", "bni_week_id", {
      eq: [["tenant_id", tenantId]],
      in: [["bni_week_id", ids]],
      pageSize: 1000,
    }),
  ]);
  const palmWeeks = new Set(attendance.map((r) => r.bni_week_id));
  return candidates
    .map((c) => ({
      label: c.label,
      slips: !slipTotals.has(c.id),
      palms: !palmWeeks.has(c.id),
    }))
    .filter((e) => e.slips || e.palms);
}
