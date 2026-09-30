import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { defaultWeekId, getCachedWeekOptions } from "@/lib/server-weeks";
import { distinctValues } from "@/lib/distinct";
import { latestImportedWeekId } from "@/lib/report-view";

export const dynamic = "force-dynamic";

export default async function VisitorsPage({
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
    .from("slip_visitors")
    .select("*, bni_weeks(label)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) query = query.or(`full_name.ilike.%${q}%,invited_by_name.ilike.%${q}%`);
  if (weekId) query = query.eq("bni_week_id", weekId);
  const columnFilters: Record<string, string> = {};
  for (const k of ["full_name", "company", "invited_by_name", "email", "phone"]) {
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
      distinctValues("slip_visitors", "full_name"),
      distinctValues("slip_visitors", "company"),
      distinctValues("slip_visitors", "invited_by_name"),
      distinctValues("slip_visitors", "email"),
      distinctValues("slip_visitors", "phone"),
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
      columns={[
        { key: "full_name", label: "Full Name" },
        { key: "company", label: "Company" },
        { key: "invited_by_name", label: "Invited By" },
        { key: "bni_week", label: "BNI Week" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
      ]}
      rows={rows}
      filterable={["full_name", "company", "invited_by_name", "email", "phone"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
