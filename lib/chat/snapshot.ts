import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";

export type MemberStat = {
  name: string;
  chapter: string | null;
  category: string | null;
  referralsGiven: number;
  referralsReceived: number;
  referralsInside: number;
  referralsOutside: number;
  oneToOnes: number;
  tyfcbTotal: number;
  visitorsInvited: number;
  invitedVisitors: string[];
};

/** All slips numbers for ONE BNI meeting week (newest-first in the snapshot). */
export type WeekStat = {
  label: string;
  meetingDate: string;
  referrals: number;
  referralsInside: number;
  referralsOutside: number;
  oneToOnes: number;
  visitors: number;
  tyfcbEntries: number;
  tyfcbAmount: number;
  uniqueReferralGivers: number;
  uniqueReferralReceivers: number;
  uniqueTyfcbReceivers: number;
};

export type SlipsSnapshot = {
  chapterName: string;
  generatedAt: string;
  totals: {
    members: number;
    weeks: number;
    referrals: number;
    oneToOnes: number;
    visitors: number;
    tyfcbEntries: number;
    tyfcbAmount: number;
  };
  recentWeeks: string[];
  /** One entry per meeting week, newest first. weekly[0] = latest week. */
  weekly: WeekStat[];
  /** Label of the newest week that actually has slips (weekly[0] can be an
   *  upcoming week with no data yet). */
  latestWithDataLabel: string | null;
  members: MemberStat[];
};

const key = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
const amount = (v: number | string | null): number => {
  const n = Number(String(v ?? 0).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Compact, privacy-safe dataset of the whole slips database for the AI. */
export async function getSlipsSnapshot(): Promise<SlipsSnapshot> {
  const sb = getSupabaseServer();
  const chapterName = process.env.NEXT_PUBLIC_CHAPTER_NAME || "BNI Chapter";

  // NOTE: fetchAllRows, never .limit() — Supabase returns at most 1000 rows
  // per request, and the DB is already past the old hand-picked caps
  // (500 members / 60 weeks), which silently hid data from the AI.
  const [membersRows, weeksRows, refRes, otoRes, tyfcbRes, visRes] = await Promise.all([
    fetchAllRows<{ name: string; category: string | null; chapters: { name: string } | { name: string }[] | null }>(
      "members",
      "name,category,chapters(name)",
      // Order by a unique column: a non-unique sort key can repeat/skip rows
      // when range-paging crosses a page boundary.
      { order: { column: "id" }, pageSize: 1000 },
    ),
    fetchAllRows<{ id: string; label: string; meeting_date: string }>(
      "bni_weeks",
      "id,label,meeting_date",
      { order: { column: "meeting_date", ascending: false }, pageSize: 500 },
    ),
    fetchAllRows<{ bni_week_id: string | null; from_name: string; to_name: string; inside_outside: string | null }>(
      "slip_referrals",
      "bni_week_id,from_name,to_name,inside_outside",
      { order: { column: "id" }, pageSize: 1000 },
    ),
    fetchAllRows<{
      bni_week_id: string | null;
      initiated_by_name: string;
      met_with_name: string;
      initiated_by_is_other_chapter: boolean | null;
      met_with_is_other_chapter: boolean | null;
    }>(
      "slip_one_to_ones",
      "bni_week_id,initiated_by_name,met_with_name,initiated_by_is_other_chapter,met_with_is_other_chapter",
      { order: { column: "id" }, pageSize: 1000 },
    ),
    fetchAllRows<{ bni_week_id: string | null; member_name: string; amount: number | string | null }>(
      "slip_tyfcb",
      "bni_week_id,member_name,amount",
      { order: { column: "id" }, pageSize: 1000 },
    ),
    fetchAllRows<{ bni_week_id: string | null; full_name: string; invited_by_name: string | null }>(
      "slip_visitors",
      "bni_week_id,full_name,invited_by_name",
      { order: { column: "id" }, pageSize: 1000 },
    ),
  ]);

  const stats = new Map<string, MemberStat>();
  const ensure = (name: string, chapter: string | null = null): MemberStat | null => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const k = key(clean);
    let s = stats.get(k);
    if (!s) {
      s = {
        name: clean,
        chapter,
        category: null,
        referralsGiven: 0,
        referralsReceived: 0,
        referralsInside: 0,
        referralsOutside: 0,
        oneToOnes: 0,
        tyfcbTotal: 0,
        visitorsInvited: 0,
        invitedVisitors: [],
      };
      stats.set(k, s);
    }
    return s;
  };

  for (const m of membersRows) {
    const rel = Array.isArray(m.chapters) ? m.chapters[0] : m.chapters;
    const s = ensure(m.name, rel?.name ?? null);
    if (s) {
      s.category = m.category;
      if (!s.chapter && rel?.name) s.chapter = rel.name;
    }
  }

  // Per-week buckets keyed by week id (built from the weeks table so every
  // meeting week appears, even a week whose slips are all zero).
  type Bucket = {
    stat: Omit<WeekStat, "label" | "meetingDate" | "uniqueReferralGivers" | "uniqueReferralReceivers" | "uniqueTyfcbReceivers">;
    givers: Set<string>;
    receivers: Set<string>;
    tyfcbReceivers: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  const bucketOf = (weekId: string | null | undefined): Bucket | undefined =>
    (weekId ? buckets.get(weekId) : undefined);
  for (const w of weeksRows) {
    buckets.set(w.id, {
      stat: { referrals: 0, referralsInside: 0, referralsOutside: 0, oneToOnes: 0, visitors: 0, tyfcbEntries: 0, tyfcbAmount: 0 },
      givers: new Set(),
      receivers: new Set(),
      tyfcbReceivers: new Set(),
    });
  }

  for (const r of refRes) {
    const from = ensure(r.from_name);
    const to = ensure(r.to_name);
    if (from) {
      from.referralsGiven += 1;
      if (r.inside_outside === "Inside") from.referralsInside += 1;
      else if (r.inside_outside === "Outside") from.referralsOutside += 1;
    }
    if (to) to.referralsReceived += 1;
    const b = bucketOf(r.bni_week_id);
    if (b) {
      b.stat.referrals += 1;
      if (r.inside_outside === "Inside") b.stat.referralsInside += 1;
      else if (r.inside_outside === "Outside") b.stat.referralsOutside += 1;
      const g = key(r.from_name);
      const rc = key(r.to_name);
      if (g) b.givers.add(g);
      if (rc) b.receivers.add(rc);
    }
  }

  for (const r of otoRes) {
    // A 121 counts as participation for both sides (once if same person).
    const init = ensure(r.initiated_by_name);
    if (init) init.oneToOnes += 1;
    const met = ensure(r.met_with_name);
    if (met && (!init || key(met.name) !== key(init.name))) met.oneToOnes += 1;
    const b = bucketOf(r.bni_week_id);
    if (b) {
      // Weighted like the report: both home members = 2, other-chapter side = 1.
      b.stat.oneToOnes += r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2;
    }
  }

  let tyfcbAmount = 0;
  for (const r of tyfcbRes) {
    const amt = amount(r.amount);
    tyfcbAmount += amt;
    const s = ensure(r.member_name);
    if (s) s.tyfcbTotal += amt;
    const b = bucketOf(r.bni_week_id);
    if (b) {
      b.stat.tyfcbEntries += 1;
      b.stat.tyfcbAmount += amt;
      const recv = key(r.member_name);
      if (recv) b.tyfcbReceivers.add(recv);
    }
  }

  for (const r of visRes) {
    if (r.invited_by_name) {
      const s = ensure(r.invited_by_name);
      if (s) {
        s.visitorsInvited += 1;
        const guest = r.full_name.replace(/\s+/g, " ").trim();
        if (guest && s.invitedVisitors.length < 20 && !s.invitedVisitors.includes(guest)) {
          s.invitedVisitors.push(guest);
        }
      }
    }
    const b = bucketOf(r.bni_week_id);
    if (b) b.stat.visitors += 1;
  }

  const members = [...stats.values()].sort((a, b) =>
    b.referralsGiven + b.referralsReceived + b.tyfcbTotal / 100000 - (a.referralsGiven + a.referralsReceived + a.tyfcbTotal / 100000),
  );

  const weekly: WeekStat[] = weeksRows.map((w) => {
    const b = buckets.get(w.id)!;
    return {
      label: w.label,
      meetingDate: w.meeting_date,
      ...b.stat,
      uniqueReferralGivers: b.givers.size,
      uniqueReferralReceivers: b.receivers.size,
      uniqueTyfcbReceivers: b.tyfcbReceivers.size,
    };
  });

  const referrals = refRes.length;
  // Owner count: a 121 with a bold (other-chapter) side counts 1,
  // a meeting between two home members counts 2. Per-member participation
  // above stays 1-per-member.
  const oneToOnes = otoRes.reduce(
    (n, r) => n + (r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2),
    0,
  );
  const visitors = visRes.length;

  return {
    chapterName,
    generatedAt: new Date().toISOString(),
    totals: {
      members: membersRows.length,
      weeks: weeksRows.length,
      referrals,
      oneToOnes,
      visitors,
      tyfcbEntries: tyfcbRes.length,
      tyfcbAmount: Math.round(tyfcbAmount),
    },
    recentWeeks: weeksRows.map((w) => w.label).slice(0, 12),
    weekly,
    latestWithDataLabel:
      weekly.find((w) => w.referrals > 0 || w.oneToOnes > 0 || w.visitors > 0 || w.tyfcbEntries > 0)?.label ?? null,
    members,
  };
}
