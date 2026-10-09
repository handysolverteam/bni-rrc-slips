import ListShell from "@/components/ListShell";
import NoAccess from "@/components/NoAccess";
import { getSupabaseServer } from "@/lib/supabase/server";
import { distinctValues } from "@/lib/distinct";
import { applyColumnFilter, multiParts } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function MembersPage({
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
  const activeOnly = sp.active === "1";
  const sb = getSupabaseServer();
  let query = sb
    .from("members")
    .select("*, chapters(name)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  if (activeOnly) query = query.eq("is_inactive", false);
  const columnFilters: Record<string, string> = {};
  for (const k of ["name", "category", "company", "phone"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) columnFilters[k] = v;
  }
  const chapterV = (sp.c_chapter || "").trim();
  let chapterIds: string[] = [];
  if (chapterV) {
    const { data: chapters } = await sb
      .from("chapters")
      .select("id, name")
      .eq("tenant_id", tenantId);
    const names = multiParts(chapterV).map((s) => s.toLowerCase());
    chapterIds = (chapters ?? [])
      .filter((c) => names.includes(String(c.name ?? "").trim().toLowerCase()))
      .map((c) => c.id);
    columnFilters.chapter = chapterV;
  }
  // Rows AND the header counts below must reflect the same filters, so the
  // chain lives here once: q, then the column filters (chapter resolves to
  // ids, the rest pass through applyColumnFilter).
  const applyFilters = (b: any): any => {
    let out = b;
    if (q) out = out.ilike("name", `%${q}%`);
    for (const [k, v] of Object.entries(columnFilters)) {
      if (k === "chapter") continue;
      out = applyColumnFilter(out, k, v);
    }
    if (chapterV) out = out.in("chapter_id", chapterIds.length > 0 ? chapterIds : ["00000000-0000-0000-0000-000000000000"]);
    return out;
  };
  query = applyFilters(query);
  if (activeOnly) query = query.eq("is_inactive", false);
// Everyone sees active and inactive members, so dropdowns list both.
const memberEq: [string, unknown][] = [];
  const [{ data, count }, filterOptions, counts] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    Promise.all([
      distinctValues(tenantId, "chapters", "name"),
      distinctValues(tenantId, "members", "name", memberEq),
      distinctValues(tenantId, "members", "category", memberEq),
      distinctValues(tenantId, "members", "company", memberEq),
      distinctValues(tenantId, "members", "phone", memberEq),
    ]).then(([chapter, name, category, company, phone]) => ({
      chapter,
      name,
      category,
      company,
      phone,
    })),
    // Header counts follow the current filters; the Active toggle only
    // swaps the wording to "N active".
    Promise.all([
      applyFilters(sb.from("members").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)),
      applyFilters(sb.from("members").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)).eq("is_inactive", false),
    ]).then(([all, act]) => ({ all: all.count ?? 0, active: act.count ?? 0 })),
  ]);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((m) => {
    const rel = m.chapters as { name?: string } | { name?: string }[] | null;
    return {
      ...m,
      active: m.is_inactive !== true,
      chapter: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? "",
    };
  });

  return (
    <ListShell
      title="Bni Member"
      total={count ?? 0}
      page={page}
      pageSize={pageSize}
      basePath="/members"
      q={q}
      weekId=""
      weeks={[]}
      // Both counts always show — the Active checkbox only narrows the rows.
      sub={`${counts.active.toLocaleString("en-IN")} active · ${(counts.all - counts.active).toLocaleString("en-IN")} inactive`}
      activeToggle={{ param: "active", label: "Active", checked: activeOnly }}
      columns={[
        ...[{ key: "active", label: "Active" }],
        { key: "name", label: "Name" },
        { key: "chapter", label: "Chapter" },
        { key: "category", label: "Category" },
        { key: "company", label: "Company" },
        { key: "phone", label: "Phone" },
      ]}
      rows={rows}
      filterable={["name", "chapter", "category", "company", "phone"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
