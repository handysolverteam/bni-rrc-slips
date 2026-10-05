import ListShell from "@/components/ListShell";
import NoAccess from "@/components/NoAccess";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions, listWeekScope } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { weekFilterOptions } from "@/lib/weeks";
import { applyColumnFilter, applyWeekFilter } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const tenantId = guard.tenantId;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page || 1));
  const pageSize = 100;
  const q = sp.q || "";
  const { weekId, weekFilter } = await listWeekScope(tenantId, sp);
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_referrals")
    .select("*, bni_weeks(label)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (q) query = query.or(`from_name.ilike.%${q}%,to_name.ilike.%${q}%`);
  if (weekId) query = applyWeekFilter(query, weekId);
  const columnFilters: Record<string, string> = {};
  if (weekFilter) columnFilters.bni_week = weekFilter;
  for (const k of ["from_name", "to_name", "other_chapter_member", "inside_outside"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      query = applyColumnFilter(query, k, v);
      columnFilters[k] = v;
    }
  }
  const [{ data, count }, weeks, baseOptions] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(tenantId),
    Promise.all([
      distinctValues(tenantId, "slip_referrals", "from_name"),
      distinctValues(tenantId, "slip_referrals", "to_name"),
      distinctValues(tenantId, "slip_referrals", "other_chapter_member"),
      distinctValues(tenantId, "slip_referrals", "inside_outside"),
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
      hideWeekBar
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "from_name", label: "Referral From" },
        { key: "to_name", label: "Referral To" },
        { key: "other_chapter_member", label: "Other Member's Chapter" },
        { key: "inside_outside", label: "Inside Or Outside" },
      ]}
      rows={rows}
      filterable={["bni_week", "from_name", "to_name", "other_chapter_member", "inside_outside"]}
      columnFilters={columnFilters}
      filterOptions={{ ...baseOptions, bni_week: weekFilterOptions(weeks) }}
    />
  );
}
