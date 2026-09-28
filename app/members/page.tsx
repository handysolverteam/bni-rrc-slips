import ListShell from "@/components/ListShell";
import { getSupabaseServer } from "@/lib/supabase/server";

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
  let query = sb.from("members").select("*", { count: "exact" }).order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);

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
      searchPlaceholder="Search by name…"
      columns={[
        { key: "name", label: "Name" },
        { key: "category", label: "Category" },
        { key: "company", label: "Company" },
        { key: "phone", label: "Contact" },
      ]}
      rows={(data ?? []) as Record<string, unknown>[]}
    />
  );
}
