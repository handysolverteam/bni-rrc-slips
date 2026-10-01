import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions, listWeekScope } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { weekFilterOptions } from "@/lib/weeks";

export const dynamic = "force-dynamic";

export default async function CeusPage({
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
    .from("slip_ceus")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.ilike("member_name", `%${q}%`);
  if (weekId) query = query.eq("bni_week_id", weekId);
  const columnFilters: Record<string, string> = {};
  if (weekFilter) columnFilters.bni_week = weekFilter;
  for (const k of ["member_name"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      query = query.ilike(k, `%${v}%`);
      columnFilters[k] = v;
    }
  }
  const creditsV = (sp.c_credits || "").trim();
  if (creditsV && Number.isFinite(Number(creditsV))) {
    query = query.eq("credits", Number(creditsV));
    columnFilters.credits = creditsV;
  }
  const [{ data, count }, weeks, baseOptions] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(),
    Promise.all([
      distinctValues("slip_ceus", "member_name"),
      distinctValues("slip_ceus", "credits"),
    ]).then(([member_name, credits]) => ({
      member_name,
      credits: credits
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .map((n) => ({ value: String(n), label: String(n) })),
    })),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip CEU"
      kind="ceu"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/ceus"
      q={q}
      weekId={weekId}
      weeks={weeks}
      hideWeekBar
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "member_name", label: "BNI Member" },
        { key: "credits", label: "CEU Credits" },
      ]}
      rows={rows}
      filterable={["bni_week", "member_name", "credits"]}
      columnFilters={columnFilters}
      filterOptions={{ ...baseOptions, bni_week: weekFilterOptions(weeks) }}
    />
  );
}
