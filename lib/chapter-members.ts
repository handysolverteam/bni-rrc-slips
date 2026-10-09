import { cachedSwr } from "@/lib/cache";
import { fetchAllRows } from "@/lib/supabase/paged";
import { fetchHomeChapterId } from "@/lib/trends";

export type ChapterMember = { name: string; inactive: boolean };
export type OtherChapter = {
  id: string;
  name: string;
  /** All members filed under this chapter. */
  total: number;
  active: number;
  inactive: number;
  members: ChapterMember[];
};

/**
 * Every chapter OTHER than the tenant's Home Chapter with the members the
 * import filed under it (members.chapter_id), largest chapter first (ties by
 * name). Member names are sorted A–Z; inactive members are included and
 * flagged so the screen can show both counts.
 */
export function fetchOtherChapters(tenantId: string): Promise<OtherChapter[]> {
  return cachedSwr(`otherchapters:${tenantId}`, 60_000, () => computeOtherChapters(tenantId));
}

async function computeOtherChapters(tenantId: string): Promise<OtherChapter[]> {
  const [homeId, chapters, members] = await Promise.all([
    fetchHomeChapterId(tenantId),
    fetchAllRows<{ id: string; name: string }>("chapters", "id,name", {
      eq: [["tenant_id", tenantId]],
      pageSize: 1000,
    }),
    fetchAllRows<{ name: string; chapter_id: string; is_inactive: boolean | null }>(
      "members",
      "name,chapter_id,is_inactive",
      { eq: [["tenant_id", tenantId]], pageSize: 1000 },
    ),
  ]);
  const byChapter = new Map<string, ChapterMember[]>();
  for (const m of members) {
    if (!m.chapter_id || m.chapter_id === homeId) continue;
    const list = byChapter.get(m.chapter_id) ?? [];
    list.push({ name: m.name, inactive: m.is_inactive === true });
    byChapter.set(m.chapter_id, list);
  }
  return chapters
    .filter((c) => c.id !== homeId && byChapter.has(c.id))
    .map((c) => {
      const list = (byChapter.get(c.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      const inactive = list.filter((m) => m.inactive).length;
      return {
        id: c.id,
        name: c.name,
        total: list.length,
        active: list.length - inactive,
        inactive,
        members: list,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
