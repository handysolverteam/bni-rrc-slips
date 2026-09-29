import { getSupabaseServer } from "@/lib/supabase/server";

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
  members: MemberStat[];
};

const key = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();

/** Compact, privacy-safe dataset of the whole slips database for the AI. */
export async function getSlipsSnapshot(): Promise<SlipsSnapshot> {
  const sb = getSupabaseServer();
  const chapterName = process.env.NEXT_PUBLIC_CHAPTER_NAME || "BNI Chapter";

  const [membersRes, weeksRes, refRes, otoRes, tyfcbRes, visRes] = await Promise.all([
    sb.from("members").select("name,category,chapters(name)").order("name").limit(500),
    sb.from("bni_weeks").select("label,meeting_date").order("meeting_date", { ascending: false }).limit(60),
    sb.from("slip_referrals").select("from_name,to_name,inside_outside").limit(8000),
    sb.from("slip_one_to_ones").select("initiated_by_name,met_with_name").limit(8000),
    sb.from("slip_tyfcb").select("member_name,amount").limit(8000),
    sb.from("slip_visitors").select("full_name,invited_by_name").limit(3000),
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
      };
      stats.set(k, s);
    }
    return s;
  };

  for (const m of (membersRes.data ?? []) as { name: string; category: string | null; chapters: { name: string } | { name: string }[] | null }[]) {
    const rel = Array.isArray(m.chapters) ? m.chapters[0] : m.chapters;
    const s = ensure(m.name, rel?.name ?? null);
    if (s) {
      s.category = m.category;
      if (!s.chapter && rel?.name) s.chapter = rel.name;
    }
  }

  for (const r of (refRes.data ?? []) as { from_name: string; to_name: string; inside_outside: string | null }[]) {
    const from = ensure(r.from_name);
    const to = ensure(r.to_name);
    if (from) {
      from.referralsGiven += 1;
      if (r.inside_outside === "Inside") from.referralsInside += 1;
      else if (r.inside_outside === "Outside") from.referralsOutside += 1;
    }
    if (to) to.referralsReceived += 1;
  }

  for (const r of (otoRes.data ?? []) as { initiated_by_name: string; met_with_name: string }[]) {
    // A 121 counts as participation for both sides (once if same person).
    const init = ensure(r.initiated_by_name);
    if (init) init.oneToOnes += 1;
    const met = ensure(r.met_with_name);
    if (met && (!init || key(met.name) !== key(init.name))) met.oneToOnes += 1;
  }

  let tyfcbAmount = 0;
  for (const r of (tyfcbRes.data ?? []) as { member_name: string; amount: number | string | null }[]) {
    const amt = Number(r.amount ?? 0);
    if (Number.isFinite(amt)) tyfcbAmount += amt;
    const s = ensure(r.member_name);
    if (s && Number.isFinite(amt)) s.tyfcbTotal += amt;
  }

  for (const r of (visRes.data ?? []) as { full_name: string; invited_by_name: string | null }[]) {
    if (r.invited_by_name) {
      const s = ensure(r.invited_by_name);
      if (s) s.visitorsInvited += 1;
    }
  }

  const members = [...stats.values()].sort((a, b) =>
    b.referralsGiven + b.referralsReceived + b.tyfcbTotal / 100000 - (a.referralsGiven + a.referralsReceived + a.tyfcbTotal / 100000),
  );

  const referrals = (refRes.data ?? []).length;
  const oneToOnes = (otoRes.data ?? []).length;
  const visitors = (visRes.data ?? []).length;

  return {
    chapterName,
    generatedAt: new Date().toISOString(),
    totals: {
      members: (membersRes.data ?? []).length,
      weeks: (weeksRes.data ?? []).length,
      referrals,
      oneToOnes,
      visitors,
      tyfcbEntries: (tyfcbRes.data ?? []).length,
      tyfcbAmount: Math.round(tyfcbAmount),
    },
    recentWeeks: ((weeksRes.data ?? []) as { label: string }[]).slice(0, 12).map((w) => w.label),
    members,
  };
}
