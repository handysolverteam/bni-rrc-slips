import { fetchAllRows } from "@/lib/supabase/paged";
import { rankTop, type MonthTop } from "@/lib/monthly-top-share";

type Joined = { meeting_date: string | null } | { meeting_date: string | null }[] | null;
type Ranked = { name: string | null; value: number }[];

const dateOf = (j: Joined | undefined): string | null =>
  (Array.isArray(j) ? j[0]?.meeting_date : j?.meeting_date) ?? null;

/**
 * Month-wise top 3 for the Top 3 screen: TYFCB (summed ₹ per thanked member),
 * Referrals (referrals given per member) and Visitors (visitors brought per
 * inviter), grouped by the meeting month of each slip, over every imported
 * week of the tenant (the screen filters the months). Referral givers from
 * another chapter (bold outsiders) are skipped. Newest month first.
 */
export async function fetchMonthlyTop(tenantId: string): Promise<MonthTop[]> {
  const filters = { eq: [["tenant_id", tenantId]] as [string, string][] };
  const [tyfcb, ref, vis] = await Promise.all([
    fetchAllRows<{ member_name: string; amount: number | string | null; bni_weeks: Joined }>(
      "slip_tyfcb",
      "member_name,amount,bni_weeks(meeting_date)",
      filters,
    ),
    fetchAllRows<{ from_name: string; from_is_other_chapter: boolean | null; bni_weeks: Joined }>(
      "slip_referrals",
      "from_name,from_is_other_chapter,bni_weeks(meeting_date)",
      filters,
    ),
    fetchAllRows<{ invited_by_name: string | null; bni_weeks: Joined }>(
      "slip_visitors",
      "invited_by_name,bni_weeks(meeting_date)",
      filters,
    ),
  ]);

  type Bucket = { tyfcb: Ranked; referral: Ranked; visitor: Ranked };
  const buckets = new Map<string, Bucket>();
  const at = (j: Joined | undefined): Bucket | null => {
    const d = dateOf(j);
    if (!d) return null;
    const key = d.slice(0, 7);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { tyfcb: [], referral: [], visitor: [] }));
    return b;
  };
  for (const r of tyfcb) at(r.bni_weeks)?.tyfcb.push({ name: r.member_name, value: Number(r.amount ?? 0) });
  for (const r of ref) {
    if (r.from_is_other_chapter) continue;
    at(r.bni_weeks)?.referral.push({ name: r.from_name, value: 1 });
  }
  for (const r of vis) at(r.bni_weeks)?.visitor.push({ name: r.invited_by_name, value: 1 });

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, b]) => ({
      key,
      label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      tyfcb: rankTop(b.tyfcb),
      referral: rankTop(b.referral),
      visitor: rankTop(b.visitor),
    }));
}
