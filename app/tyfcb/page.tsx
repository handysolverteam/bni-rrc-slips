import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";

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
  const weekId = sp.week || "";
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_tyfcb")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.ilike("member_name", `%${q}%`);
  if (weekId) query = query.eq("bni_week_id", weekId);
  const columnFilters: Record<string, string> = {};
  for (const k of ["member_name", "other_chapter_member"]) {
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
      distinctValues("slip_tyfcb", "member_name"),
      distinctValues("slip_tyfcb", "other_chapter_member"),
    ]).then(([member_name, other_chapter_member]) => ({
      member_name,
      other_chapter_member,
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
      searchPlaceholder="Search member…"
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "member_name", label: "BNI Member" },
        { key: "amount", label: "Amount" },
        { key: "other_chapter_member", label: "Other Chapter Member" },
      ]}
      rows={rows}
      filterable={["member_name", "other_chapter_member"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
