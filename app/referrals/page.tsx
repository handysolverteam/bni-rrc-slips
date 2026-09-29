import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page || 1));
  const pageSize = 100;
  const q = sp.q || "";
  const weekId = sp.week || "";
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_referrals")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.or(`from_name.ilike.%${q}%,to_name.ilike.%${q}%`);
  if (weekId) query = query.eq("bni_week_id", weekId);
  const columnFilters: Record<string, string> = {};
  for (const k of ["from_name", "to_name", "other_chapter_member", "inside_outside"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      query = query.ilike(k, `%${v}%`);
      columnFilters[k] = v;
    }
  }
  const [{ data, count }, weeks, filterOptions] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(),
    Promise.all([
      distinctValues("slip_referrals", "from_name"),
      distinctValues("slip_referrals", "to_name"),
      distinctValues("slip_referrals", "other_chapter_member"),
      distinctValues("slip_referrals", "inside_outside"),
    ]).then(([from_name, to_name, other_chapter_member, inside_outside]) => ({
      from_name,
      to_name,
      other_chapter_member,
      inside_outside,
    })),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip Referrals"
      kind="referral"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/referrals"
      q={q}
      weekId={weekId}
      weeks={weeks}
      searchPlaceholder="Search referral from / to…"
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "from_name", label: "Referral From" },
        { key: "to_name", label: "Referral To" },
        { key: "other_chapter_member", label: "Other Chapter Member" },
        { key: "inside_outside", label: "Inside Or Outside" },
      ]}
      rows={rows}
      filterable={["from_name", "to_name", "other_chapter_member", "inside_outside"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
