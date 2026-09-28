import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions } from "@/lib/server-weeks";

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
  const [{ data, count }, weeks] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    getCachedWeekOptions(),
  ]);
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    bni_week: (r.bni_weeks as { label: string } | null)?.label ?? "",
  }));

  return (
    <ListShell
      title="Slip TYFCB"
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
    />
  );
}
