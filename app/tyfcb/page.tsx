import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions, listWeekScope } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { weekFilterOptions } from "@/lib/weeks";
import { applyColumnFilter, applyWeekFilter, multiParts } from "@/lib/list-filters";

export const dynamic = "force-dynamic";

export default async function TyfcbPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page || 1));
  const pageSize = 100;
  const q = sp.q || "";
  const { weekId, weekFilter } = await listWeekScope(sp);
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_tyfcb")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.ilike("member_name", `%${q}%`);
  if (weekId) query = applyWeekFilter(query, weekId);
  const columnFilters: Record<string, string> = {};
  if (weekFilter) columnFilters.bni_week = weekFilter;
  for (const k of ["member_name", "other_chapter_member"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      query = applyColumnFilter(query, k, v);
      columnFilters[k] = v;
    }
  }
  const amountV = (sp.c_amount || "").trim();
  if (amountV) {
    const nums = multiParts(amountV).map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 1) query = query.eq("amount", nums[0]);
    else if (nums.length > 1) query = query.in("amount", nums);
    columnFilters.amount = amountV;
  }
  const [{ data, count }, weeks, baseOptions] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(),
    Promise.all([
      distinctValues("slip_tyfcb", "member_name"),
      distinctValues("slip_tyfcb", "other_chapter_member"),
      distinctValues("slip_tyfcb", "amount"),
    ]).then(([member_name, other_chapter_member, amount]) => ({
      member_name,
      other_chapter_member,
      amount: amount
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .map((n) => ({ value: String(n), label: n.toLocaleString("en-IN") })),
    })),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip TYFCB"
      kind="tyfcb"
      total={count ?? 0}
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
