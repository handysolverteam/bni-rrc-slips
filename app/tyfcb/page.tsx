import ListShell from "@/components/ListShell";
import NoAccess from "@/components/NoAccess";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions, listWeekScope } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { weekFilterOptions } from "@/lib/weeks";
import { applyColumnFilter, applyWeekFilter, multiParts } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";
import { fetchAllRows } from "@/lib/supabase/paged";
import { cachedSwr } from "@/lib/cache";

export const dynamic = "force-dynamic";

export default async function TyfcbPage({
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
  const columnFilters: Record<string, string> = {};
  if (weekFilter) columnFilters.bni_week = weekFilter;
  const amountV = (sp.c_amount || "").trim();
  const colV: [string, string][] = [];
  for (const k of ["member_name", "other_chapter_member"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      colV.push([k, v]);
      columnFilters[k] = v;
    }
  }
  if (amountV) columnFilters.amount = amountV;
  // The same filters, applied to any select (rows page, and the filtered total).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = (select: string, count?: boolean): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (count ? sb.from("slip_tyfcb").select(select, { count: "exact" }) : sb.from("slip_tyfcb").select(select)).eq("tenant_id", tenantId);
    if (q) query = query.ilike("member_name", `%${q}%`);
    if (weekId) query = applyWeekFilter(query, weekId);
    for (const [k, v] of colV) query = applyColumnFilter(query, k, v);
    if (amountV) {
      const nums = multiParts(amountV).map(Number).filter((n) => Number.isFinite(n));
      if (nums.length === 1) query = query.eq("amount", nums[0]);
      else if (nums.length > 1) query = query.in("amount", nums);
    }
    return query;
  };
  const isFiltered = Boolean(q || weekId || colV.length || amountV);
  const sumOf = (rs: { amount: number | string | null }[]) => rs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  // Total of the filtered rows: page the amount column of the same query, remaining pages in parallel.
  const filteredTotal = async (n: number): Promise<number> => {
    const pages = Math.ceil(n / 1000);
    const parts = await Promise.all(
      Array.from({ length: pages }, (_, i) => filtered("amount").order("id").range(i * 1000, i * 1000 + 999)),
    );
    return parts.reduce((s, p) => s + sumOf((p.data ?? []) as { amount: number | string | null }[]), 0);
  };
  const allTotal = () =>
    cachedSwr(`tyfcb-total:${tenantId}`, 60_000, async () =>
      sumOf(await fetchAllRows<{ amount: number | string | null }>("slip_tyfcb", "amount", { eq: [["tenant_id", tenantId]], order: { column: "id" } })),
    );
  const [{ data, count }, weeks, baseOptions, totalAll] = await Promise.all([
    filtered("*, bni_weeks(label)", true)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(tenantId),
    Promise.all([
      distinctValues(tenantId, "slip_tyfcb", "member_name"),
      distinctValues(tenantId, "slip_tyfcb", "other_chapter_member"),
      distinctValues(tenantId, "slip_tyfcb", "amount"),
    ]).then(([member_name, other_chapter_member, amount]) => ({
      member_name,
      other_chapter_member,
      amount: amount
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .map((n) => ({ value: String(n), label: `₹${n.toLocaleString("en-IN")}` })),
    })),
    allTotal(),
  ]);
  const totalFiltered = isFiltered ? await filteredTotal(count ?? 0) : totalAll;
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip TYFCB"
      kind="tyfcb"
      total={count ?? 0}
      sub={isFiltered ? `TYFCB total: ${rupees(totalFiltered)} (filtered, ${(count ?? 0).toLocaleString("en-IN")} entries) · ${rupees(totalAll)} (all entries)` : `TYFCB total: ${rupees(totalAll)} (all ${(count ?? 0).toLocaleString("en-IN")} entries)`}
      page={page}
      pageSize={pageSize}
      basePath="/tyfcb"
      q={q}
      weekId={weekId}
      weeks={weeks}
      hideWeekBar
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "member_name", label: "BNI Member" },
        { key: "amount", label: "Amount" },
        { key: "other_chapter_member", label: "Thanking Member's Chapter" },
      ]}
      rows={rows}
      filterable={["bni_week", "member_name", "amount", "other_chapter_member"]}
      columnFilters={columnFilters}
      filterOptions={{ ...baseOptions, bni_week: weekFilterOptions(weeks) }}
    />
  );
}
