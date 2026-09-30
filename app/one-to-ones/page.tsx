import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { defaultWeekId, getCachedWeekOptions } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { latestImportedWeekId } from "@/lib/report-view";

export const dynamic = "force-dynamic";

export default async function OneToOnesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page || 1));
  const pageSize = 100;
  const q = sp.q || "";
  const weekId =
    sp.week === "all"
      ? ""
      : sp.week ||
        (await Promise.all([defaultWeekId(), latestImportedWeekId()]).then(
          ([d, l]) => d || l,
        )) ||
        "";
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_one_to_ones")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.or(`initiated_by_name.ilike.%${q}%,met_with_name.ilike.%${q}%`);
  if (weekId) query = query.eq("bni_week_id", weekId);
  const columnFilters: Record<string, string> = {};
  for (const k of ["initiated_by_name", "met_with_name", "other_chapter_member"]) {
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
      distinctValues("slip_one_to_ones", "initiated_by_name"),
      distinctValues("slip_one_to_ones", "met_with_name"),
      distinctValues("slip_one_to_ones", "other_chapter_member"),
    ]).then(([initiated_by_name, met_with_name, other_chapter_member]) => ({
      initiated_by_name,
      met_with_name,
      other_chapter_member,
    })),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip 121"
      kind="one-to-one"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/one-to-ones"
      q={q}
      weekId={weekId}
      weeks={weeks}
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "initiated_by_name", label: "Initiated By" },
        { key: "met_with_name", label: "Met With" },
        { key: "other_chapter_member", label: "Other Member's Chapter" },
      ]}
      rows={rows}
      filterable={["initiated_by_name", "met_with_name", "other_chapter_member"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
