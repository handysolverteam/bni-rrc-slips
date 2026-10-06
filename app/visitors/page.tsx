import ListShell from "@/components/ListShell";
import NoAccess from "@/components/NoAccess";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions, listWeekScope } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { weekFilterOptions } from "@/lib/weeks";
import { applyColumnFilter, applyWeekFilter } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function VisitorsPage({
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
    .from("slip_visitors")
    .select("*, bni_weeks(label)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (q) query = query.or(`full_name.ilike.%${q}%,invited_by_name.ilike.%${q}%`);
  if (weekId) query = applyWeekFilter(query, weekId);
  const columnFilters: Record<string, string> = {};
  if (weekFilter) columnFilters.bni_week = weekFilter;
  for (const k of ["full_name", "company", "invited_by_name", "email", "phone"]) {
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
      distinctValues(tenantId, "slip_visitors", "full_name"),
      distinctValues(tenantId, "slip_visitors", "company"),
      distinctValues(tenantId, "slip_visitors", "invited_by_name"),
      distinctValues(tenantId, "slip_visitors", "email"),
      distinctValues(tenantId, "slip_visitors", "phone"),
    ]).then(([full_name, company, invited_by_name, email, phone]) => ({
      full_name,
      company,
      invited_by_name,
      email,
      phone,
    })),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip Visitors"
      kind="visitor"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/visitors"
      q={q}
      weekId={weekId}
      weeks={weeks}
      hideWeekBar
      columns={[
        { key: "full_name", label: "Full Name" },
        { key: "company", label: "Company" },
        { key: "invited_by_name", label: "Invited By" },
        { key: "bni_week", label: "BNI Week" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
      ]}
      rows={rows}
      filterable={["bni_week", "full_name", "company", "invited_by_name", "email", "phone"]}
      columnFilters={columnFilters}
      filterOptions={{ ...baseOptions, bni_week: weekFilterOptions(weeks) }}
    />
  );
}
