import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { distinctValues } from "@/lib/distinct";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page || 1));
  const pageSize = 100;
  const q = sp.q || "";
  const sb = getSupabaseServer();
  let query = sb.from("members").select("*, chapters(name)", { count: "exact" }).order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const columnFilters: Record<string, string> = {};
  for (const k of ["name", "category", "company", "phone"]) {
    const v = (sp[`c_${k}`] || "").trim();
    if (v) {
      query = query.ilike(k, `%${v}%`);
      columnFilters[k] = v;
    }
  }
  const [{ data, count }, filterOptions] = await Promise.all([
    query.range((page - 1) * pageSize, page * pageSize - 1),
    Promise.all([
      distinctValues("members", "name"),
      distinctValues("members", "category"),
      distinctValues("members", "company"),
      distinctValues("members", "phone"),
    ]).then(([name, category, company, phone]) => ({
      name,
      category,
      company,
      phone,
    })),
  ]);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((m) => {
    const rel = m.chapters as { name?: string } | { name?: string }[] | null;
    return {
      ...m,
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
      columns={[
        { key: "name", label: "Name" },
        { key: "chapter", label: "Chapter" },
        { key: "category", label: "Category" },
        { key: "company", label: "Company" },
        { key: "phone", label: "Contact" },
      ]}
      rows={rows}
      filterable={["name", "category", "company", "phone"]}
      columnFilters={columnFilters}
      filterOptions={filterOptions}
    />
  );
}
