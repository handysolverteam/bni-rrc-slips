import { cachedSwr } from "@/lib/cache";
import { homeChapterNameOf } from "@/lib/new-members";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";
import { buildTrafficRows, sortTrafficRows, windowMeetings, type BniRow, type Meeting, type SlipRows, type TrafficRow } from "@/lib/traffic-light-calc";

export type BniMonth = { month: string; rows: BniRow[]; filename: string | null };

export type TrafficData = {
  homeName: string;
  /** Every imported meeting (slips or PALMS attendance), any date. */
  meetings: Meeting[];
  /** Active members of the home chapter. */
  members: string[];
  slips: SlipRows;
  /** BNI's imported Traffic Lights files, by report month (empty until migration 010 is run + a file imported). */
  bni: BniMonth[];
  /** false when the bni_traffic_lights table does not exist yet. */
  bniTableReady: boolean;
};

/** Everything the screen needs, read once and cached for a minute (writes clear it with the other caches). */
export function fetchTrafficData(tenantId: string): Promise<TrafficData> {
  return cachedSwr(`traffic:${tenantId}`, 60_000, () => load(tenantId));
}

async function load(tenantId: string): Promise<TrafficData> {
  const sb = getSupabaseServer();
  const eq = { eq: [["tenant_id", tenantId]] as [string, string][] };
  const ord = { ...eq, order: { column: "id" } };
  const [refs, otos, ceus, tyf, vis, att, members, homeName, batches] = await Promise.all([
    fetchAllRows<{ bni_week_id: string; from_name: string; from_is_other_chapter: boolean | null }>("slip_referrals", "bni_week_id,from_name,from_is_other_chapter", ord),
    fetchAllRows<{
      bni_week_id: string;
      initiated_by_name: string;
      met_with_name: string;
      initiated_by_is_other_chapter: boolean | null;
      met_with_is_other_chapter: boolean | null;
    }>("slip_one_to_ones", "bni_week_id,initiated_by_name,met_with_name,initiated_by_is_other_chapter,met_with_is_other_chapter", ord),
    fetchAllRows<{ bni_week_id: string; member_name: string; credits: number | string | null }>("slip_ceus", "bni_week_id,member_name,credits", ord),
    fetchAllRows<{ bni_week_id: string; member_name: string; amount: number | string | null }>("slip_tyfcb", "bni_week_id,member_name,amount", ord),
    fetchAllRows<{ bni_week_id: string; invited_by_name: string | null }>("slip_visitors", "bni_week_id,invited_by_name", ord),
    fetchAllRows<{ bni_week_id: string; member_name: string; present: number; absent: number; l: number; m: number; s: number }>(
      "member_attendance",
      "bni_week_id,member_name,present,absent,l,m,s",
      ord,
    ),
    fetchAllRows<{ name: string; is_inactive: boolean | null; chapters: { name: string } | { name: string }[] | null }>(
      "members",
      "name,is_inactive,chapters(name)",
      ord,
    ),
    homeChapterNameOf(tenantId),
    sb.from("import_batches").select("bni_week_id").eq("tenant_id", tenantId).not("bni_week_id", "is", null),
  ]);

  const weekIds = new Set<string>([
    ...(batches.data ?? []).map((b) => b.bni_week_id as string),
    ...att.map((a) => a.bni_week_id),
  ]);
  const meetings: Meeting[] = [];
  if (weekIds.size > 0) {
    const { data } = await sb.from("bni_weeks").select("id,meeting_date").in("id", [...weekIds]);
    for (const w of data ?? []) if (w.meeting_date) meetings.push({ id: w.id as string, date: String(w.meeting_date) });
  }
  meetings.sort((a, b) => (a.date < b.date ? -1 : 1));

  const homeKey = homeName.trim().toLowerCase();
  const homeMembers = members
    .filter((m) => {
      const ch = Array.isArray(m.chapters) ? m.chapters[0]?.name : m.chapters?.name;
      return m.is_inactive !== true && !!ch && ch.trim().toLowerCase() === homeKey;
    })
    .map((m) => m.name.replace(/\s+/g, " ").trim())
    .sort((a, b) => a.localeCompare(b));

  const { bni, bniTableReady } = await loadBni(tenantId);

  return {
    homeName,
    meetings,
    members: homeMembers,
    bni,
    bniTableReady,
    slips: {
      referrals: refs.map((r) => ({ week: r.bni_week_id, from: r.from_name, fromOther: r.from_is_other_chapter })),
      oneToOnes: otos.map((r) => ({
        week: r.bni_week_id,
        a: r.initiated_by_name,
        aOther: r.initiated_by_is_other_chapter,
        b: r.met_with_name,
        bOther: r.met_with_is_other_chapter,
      })),
      ceus: ceus.map((r) => ({ week: r.bni_week_id, name: r.member_name, credits: Number(r.credits ?? 0) })),
      tyfcb: tyf.map((r) => ({ week: r.bni_week_id, name: r.member_name, amount: Number(r.amount ?? 0) })),
      visitors: vis.map((r) => ({ week: r.bni_week_id, inviter: r.invited_by_name })),
      attendance: att.map((r) => ({ week: r.bni_week_id, name: r.member_name, present: r.present, absent: r.absent, m: r.m, s: r.s, l: r.l })),
    },
  };
}

async function loadBni(tenantId: string): Promise<{ bni: BniMonth[]; bniTableReady: boolean }> {
  try {
    const rows = await fetchAllRows<{
      report_month: string;
      member_name: string;
      total_score: number;
      attendance_rate: number | string | null;
      attendance_score: number;
      ceu_rate: number | string | null;
      one_to_one_rate: number | string | null;
      referrals_rate: number | string | null;
      tyfcb: number | string | null;
      visitors: number;
      sponsors: number;
      filename: string | null;
    }>(
      "bni_traffic_lights",
      "report_month,member_name,total_score,attendance_rate,attendance_score,ceu_rate,one_to_one_rate,referrals_rate,tyfcb,visitors,sponsors,filename",
      { eq: [["tenant_id", tenantId]], order: { column: "id" } },
    );
    const n = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number(v));
    const byMonth = new Map<string, BniMonth>();
    for (const r of rows) {
      const month = String(r.report_month).slice(0, 7);
      const m = byMonth.get(month) ?? { month, rows: [], filename: r.filename };
      m.rows.push({
        name: r.member_name,
        total: r.total_score,
        attendanceRate: n(r.attendance_rate),
        attendanceScore: r.attendance_score,
        ceuRate: n(r.ceu_rate),
        oneToOneRate: n(r.one_to_one_rate),
        referralsRate: n(r.referrals_rate),
        tyfcb: n(r.tyfcb),
        visitors: r.visitors,
        sponsors: r.sponsors,
      });
      byMonth.set(month, m);
    }
    return { bni: [...byMonth.values()], bniTableReady: true };
  } catch {
    // Migration 010 not run yet: the screen still works, without BNI's visitors / sponsors / reference.
    return { bni: [], bniTableReady: false };
  }
}

export type TrafficView = {
  /** `YYYY-MM` of the report month shown. */
  month: string;
  /** Months that have meetings, newest first. */
  months: { key: string; label: string }[];
  meetingsInWindow: number;
  windowLabel: string;
  rows: TrafficRow[];
  hasBni: boolean;
  bniFilename: string | null;
  bniTableReady: boolean;
  /** Members with no attendance row in the window. */
  missingAttendance: number;
};

const monthLabel = (key: string): string =>
  new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Rows for the 6-month window ending in `wanted` (default: the newest month that has meetings). */
export function trafficView(data: TrafficData, wanted: string | undefined): TrafficView {
  const monthKeys = [...new Set(data.meetings.map((m) => m.date.slice(0, 7)))].sort().reverse();
  const month = wanted && monthKeys.includes(wanted) ? wanted : (monthKeys[0] ?? "");
  const meetings = month ? windowMeetings(data.meetings, month) : [];
  const bni = data.bni.find((b) => b.month === month);
  const rows = sortTrafficRows(buildTrafficRows({ members: data.members, meetings, slips: data.slips, bni: bni?.rows ?? [] }));
  const first = meetings[0]?.date.slice(0, 7);
  return {
    month,
    months: monthKeys.map((key) => ({ key, label: monthLabel(key) })),
    meetingsInWindow: meetings.length,
    windowLabel: month ? `${first ? monthLabel(first) : monthLabel(month)} – ${monthLabel(month)} · ${meetings.length} meetings` : "No meetings imported yet",
    rows,
    hasBni: !!bni,
    bniFilename: bni?.filename ?? null,
    bniTableReady: data.bniTableReady,
    missingAttendance: rows.filter((r) => r.attendance.source === "none").length,
  };
}
