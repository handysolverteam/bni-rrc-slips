import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getCachedWeekOptions } from "@/lib/server-weeks";

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
  const weekId = sp.week || "";
  const sb = getSupabaseServer();
  let query = sb
    .from("slip_one_to_ones")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.or(`initiated_by_name.ilike.%${q}%,met_with_name.ilike.%${q}%`);
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
      title="Slip 121"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/one-to-ones"
      q={q}
      weekId={weekId}
      weeks={weeks}
      searchPlaceholder="Search initiated by / met with…"
      columns={[
        { key: "bni_week", label: "BNI Week" },
        { key: "initiated_by_name", label: "Initiated By" },
        { key: "met_with_name", label: "Met With" },
        { key: "other_chapter_member", label: "Other Chapter Member" },
      ]}
      rows={rows}
    />
  );
}
