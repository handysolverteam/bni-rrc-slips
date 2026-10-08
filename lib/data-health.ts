import { getSupabaseServer } from "@/lib/supabase/server";
import { buildWeekLabel } from "@/lib/weeks";
import { missingWednesdays, todayIso } from "@/lib/missing-weeks";
import { fetchAllRows } from "@/lib/supabase/paged";

export { missingWednesdays, todayIso };
export type MissingFile = { date: string; label: string };
/** One week in scope: its Slips Audit Report is not imported yet. */
export type UnimportedEntry = { label: string; slips: boolean };

/**
 * Wednesdays between the tenant's first imported meeting and today with no
 * imported slips file — the "missing meeting file" warning on `/report`
 * (date math lives in `lib/missing-weeks.ts`, unit-tested there).
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

/** Metrics that prove a week has imported slip rows (owner/home rules). */
type SlipTotals = { slips: number };

/**
 * The app's own slip rows per week (raw rows, not page-truncated — every
 * query is range-paged), using the report's home/bold + owner-count rules.
 * `weekIds` empty = every week of the tenant.
 */
async function fetchSlipTotalsByWeek(
  tenantId: string,
  weekIds: string[],
): Promise<Map<string, SlipTotals>> {
  const opts = {
    eq: [["tenant_id", tenantId]] as [string, unknown][],
    in: weekIds.length > 0 ? ([["bni_week_id", weekIds]] as [string, string[]][]) : [],
    pageSize: 1000,
  };
  const [refs, otos, visitors, tyfcbs, ceus] = await Promise.all([
    fetchAllRows<{ bni_week_id: string; inside_outside: string | null; from_is_other_chapter: boolean | null; to_is_other_chapter: boolean | null }>(
      "slip_referrals", "bni_week_id,inside_outside,from_is_other_chapter,to_is_other_chapter", opts),
    fetchAllRows<{ bni_week_id: string; initiated_by_is_other_chapter: boolean | null; met_with_is_other_chapter: boolean | null }>(
      "slip_one_to_ones", "bni_week_id,initiated_by_is_other_chapter,met_with_is_other_chapter", opts),
    fetchAllRows<{ bni_week_id: string; invited_by_name: string | null }>(
      "slip_visitors", "bni_week_id,invited_by_name", opts),
    fetchAllRows<{ bni_week_id: string; amount: number | string }>(
      "slip_tyfcb", "bni_week_id,amount", opts),
    fetchAllRows<{ bni_week_id: string; credits: number | string }>(
      "slip_ceus", "bni_week_id,credits", opts),
  ]);

  const map = new Map<string, SlipTotals>();
  const ensure = (weekId: string): SlipTotals => {
    let t = map.get(weekId);
    if (!t) {
      t = { slips: 0 };
      map.set(weekId, t);
    }
    return t;
  };
  for (const r of refs) ensure(r.bni_week_id).slips++;
  for (const r of otos) ensure(r.bni_week_id).slips++;
  for (const r of visitors) if (r.invited_by_name) ensure(r.bni_week_id).slips++;
  for (const r of tyfcbs) ensure(r.bni_week_id).slips++;
  for (const r of ceus) ensure(r.bni_week_id).slips++;
  return map;
}

/**
 * For the selected week scope: weeks still missing their Slips Audit Report
 * — the red "… not imported yet" banner on `/report`. Explicit scope = exactly
 * those weeks; empty scope (`all`) = every week the tenant imported slips for.
 * PALMS never appears here — attendance is reported on `/palms` itself.
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

  const slipTotals = await fetchSlipTotalsByWeek(tenantId, ids);
  return candidates
    .filter((c) => !slipTotals.has(c.id))
    .map((c) => ({ label: c.label, slips: true }));
}
