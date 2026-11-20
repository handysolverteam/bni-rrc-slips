import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";
import { fetchTrafficData, rangeLabel, trafficView } from "@/lib/traffic-lights";
import { LIGHT_LABEL, type LightColor } from "@/lib/traffic-light-score";

/**
 * `chapter_reference`: data the chat snapshot does not carry — member contact details, the imported BNI Traffic
 * Lights / Sponsor reports and the PALMS-reported weekly totals. Read live from the database (tenant-scoped) when
 * the model asks for it, so it never bloats the prompt.
 */
export const REFERENCE_TOOL = {
  name: "chapter_reference",
  description:
    "Reference data not in the snapshot. topic 'contacts' = members' email / phone / company / category / chapter / power team / active (use for 'what is X's email', 'who has no email', 'list members with emails'); 'traffic_lights' = the imported BNI Traffic Lights (score out of 100, colour green/amber/red/grey, per-metric scores; use for 'who is red', 'Traffic Light of X'); 'sponsors' = the imported Chapter Sponsor Report (who sponsored whom, application date); 'palms_totals' = the totals BNI's own PALMS report states per meeting week (RGI, RGO, RRI, RRO, visitors, 121s, TYFCB, CEU).",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", enum: ["contacts", "traffic_lights", "sponsors", "palms_totals"] },
      members: { type: "array", items: { type: "string" }, description: "Member names (partial, case-insensitive). When given, no other member filter applies." },
      status: { type: "string", enum: ["active", "inactive", "any"], description: "contacts only. DEFAULT 'any'; use 'active' only when asked for active members." },
      chapter: { type: "string", description: "contacts only. DEFAULT 'home' (the Home Chapter); 'all' only when other chapters are asked for." },
      powerTeam: { type: "string", description: "contacts only: keep members of this power team (partial name, e.g. 'B To B', 'Construction'). Each contacts row carries powerTeam (null = none)." },
      hasEmail: { type: "boolean", description: "contacts only: true = only members WITH an email, false = only members WITHOUT one." },
      light: { type: "string", enum: ["green", "amber", "red", "grey"], description: "traffic_lights only: keep one colour." },
      period: { type: "string", description: "traffic_lights / sponsors: an imported range as 'YYYY-MM-DD_YYYY-MM-DD'. Default = the newest imported range; the result lists every available range." },
      limit: { type: "integer", description: "Max rows (default 150, max 300). count always covers ALL matches." },
    },
    required: ["topic"],
  },
};

const lc = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const present = (v: string | null | undefined): boolean => !!v && v.trim() !== "";

type MemberDb = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  category: string | null;
  is_inactive: boolean | null;
  power_teams: { name: string } | { name: string }[] | null;
  chapters: { name: string } | { name: string }[] | null;
};

export async function executeReference(args: unknown, tenantId: string, homeChapter: string): Promise<Record<string, unknown>> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const topic = String(a.topic ?? "");
  const limit = Math.min(300, Math.max(1, Math.floor(Number(a.limit)) || 150));
  const wanted = (Array.isArray(a.members) ? a.members : []).map(lc).filter(Boolean);
  const nameOk = (name: string): boolean => wanted.length === 0 || wanted.some((w) => lc(name).includes(w));

  if (topic === "contacts") {
    const rows = await fetchAllRows<MemberDb>("members", "name,email,phone,company,category,is_inactive,chapters(name),power_teams(name)", {
      eq: [["tenant_id", tenantId]],
      order: { column: "id" },
    });
    const status = a.status === "active" || a.status === "inactive" ? a.status : "any";
    const allChapters = lc(a.chapter) === "all";
    const named = wanted.length > 0;
    const powerTeam = lc(a.powerTeam);
    const list = rows
      .map((m) => {
        const rel = Array.isArray(m.chapters) ? m.chapters[0] : m.chapters;
        const team = Array.isArray(m.power_teams) ? m.power_teams[0] : m.power_teams;
        return {
          name: m.name.replace(/\s+/g, " ").trim(),
          email: present(m.email) ? m.email!.trim() : null,
          phone: present(m.phone) ? m.phone!.trim() : null,
          company: present(m.company) ? m.company!.trim() : null,
          category: present(m.category) ? m.category!.trim() : null,
          chapter: rel?.name ?? null,
          powerTeam: team?.name ?? null,
          active: m.is_inactive !== true,
        };
      })
      .filter((m) => nameOk(m.name))
      .filter((m) => named || allChapters || lc(m.chapter) === lc(homeChapter))
      .filter((m) => named || status === "any" || (status === "active" ? m.active : !m.active))
      .filter((m) => !powerTeam || lc(m.powerTeam).includes(powerTeam))
      .filter((m) => (typeof a.hasEmail === "boolean" ? (m.email !== null) === a.hasEmail : true))
      .sort((x, y) => x.name.localeCompare(y.name));
    return {
      count: list.length,
      withEmail: list.filter((m) => m.email).length,
      withoutEmail: list.filter((m) => !m.email).length,
      shown: Math.min(limit, list.length),
      rows: list.slice(0, limit),
      basis: {
        filtersSummary: named
          ? `Member: ${wanted.join(", ")}`
          : `${allChapters ? "All chapters" : `Home chapter (${homeChapter})`} · ${status === "any" ? "active and inactive members" : `${status} members only`}`,
      },
    };
  }

  if (topic === "traffic_lights" || topic === "sponsors") {
    const data = await fetchTrafficData(tenantId);
    if (data.needsMigration || data.reports.length === 0) return { count: 0, note: "No Traffic Lights reports have been imported yet (Traffic Lights page)." };
    const periods = data.reports.map((r) => ({ period: r.key, label: rangeLabel(r.from, r.to) }));
    const rep = data.reports.find((r) => r.key === String(a.period ?? "")) ?? data.reports[0];
    const period = rangeLabel(rep.from, rep.to);
    if (topic === "sponsors") {
      if (rep.sponsors === null) return { period, availablePeriods: periods, count: 0, note: "No Chapter Sponsor Report is imported for this range." };
      const list = rep.sponsors.filter((s) => nameOk(s.sponsor) || nameOk(s.sponsored));
      const perSponsor = new Map<string, number>();
      for (const s of list) perSponsor.set(s.sponsor, (perSponsor.get(s.sponsor) ?? 0) + 1);
      return {
        period,
        availablePeriods: periods,
        count: list.length,
        sponsorCounts: [...perSponsor.entries()].sort((x, y) => y[1] - x[1]).map(([name, count]) => ({ name, count })),
        rows: list.slice(0, limit).map((s) => ({ sponsor: s.sponsor, sponsored: s.sponsored, applicationDate: s.applicationDate })),
        basis: { filtersSummary: `Sponsor Report · ${period}` },
      };
    }
    const view = trafficView(data, rep.key);
    const light = ["green", "amber", "red", "grey"].includes(String(a.light)) ? (a.light as LightColor) : null;
    const counts: Record<string, number> = { Green: 0, Amber: 0, Red: 0, Grey: 0 };
    for (const r of view.rows) counts[LIGHT_LABEL[r.color]] += 1;
    const list = view.rows.filter((r) => nameOk(r.name) && (!light || r.color === light));
    return {
      period,
      availablePeriods: periods,
      meaning: "Score out of 100: Green 70+, Amber 50-69, Red 30-49, Grey under 30.",
      colourCounts: counts,
      count: list.length,
      sponsorReportImported: view.hasSponsorReport,
      rows: list.slice(0, limit).map((r) => ({
        name: r.name,
        total: r.total,
        colour: LIGHT_LABEL[r.color],
        attendance: r.attendance.score,
        ceu: r.ceu.score,
        oneToOne: r.oneToOne.score,
        referrals: r.referrals.score,
        tyfcb: r.tyfcb.score,
        visitors: r.visitors.score,
        sponsors: r.sponsors.score,
        notes: r.notes,
      })),
      basis: { filtersSummary: `BNI Traffic Lights · ${period}${light ? ` · ${LIGHT_LABEL[light]} only` : ""}` },
    };
  }

  if (topic === "palms_totals") {
    let rows: { bni_week_id: string; rgi: number; rgo: number; rri: number; rro: number; visitors: number; one_to_ones: number; tyfcb: number | string; ceu: number }[];
    try {
      rows = await fetchAllRows("palms_stats", "bni_week_id,rgi,rgo,rri,rro,visitors,one_to_ones,tyfcb,ceu", { eq: [["tenant_id", tenantId]] });
    } catch {
      return { count: 0, note: "PALMS totals are not available (migration 007 not applied)." };
    }
    if (rows.length === 0) return { count: 0, note: "No PALMS Chapter Summary has been imported yet." };
    const { data: weeks } = await getSupabaseServer().from("bni_weeks").select("id,label,meeting_date").in("id", rows.map((r) => r.bni_week_id));
    const byId = new Map((weeks ?? []).map((w) => [w.id as string, w as { label: string; meeting_date: string }]));
    const list = rows
      .map((r) => ({
        week: byId.get(r.bni_week_id)?.label ?? "",
        meetingDate: byId.get(r.bni_week_id)?.meeting_date ?? "",
        referralsGivenInside: r.rgi,
        referralsGivenOutside: r.rgo,
        referralsReceivedInside: r.rri,
        referralsReceivedOutside: r.rro,
        visitors: r.visitors,
        oneToOnes: r.one_to_ones,
        tyfcb: Number(r.tyfcb ?? 0),
        ceu: r.ceu,
      }))
      .sort((x, y) => (x.meetingDate < y.meetingDate ? 1 : -1));
    return { count: list.length, rows: list.slice(0, limit), basis: { filtersSummary: "PALMS Chapter Summary totals as BNI reports them (not recomputed from slips)" } };
  }

  return { error: `Unknown topic: ${topic}` };
}
