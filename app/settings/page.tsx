import NoAccess from "@/components/NoAccess";
import SettingsPanel from "@/components/SettingsPanel";
import { listImportTargets } from "@/lib/chapter-target";
import { homeChapterNameOf } from "@/lib/new-members";
import { requirePageTenant } from "@/lib/server-auth";
import { fetchAllRows } from "@/lib/supabase/paged";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const tenantId = guard.tenantId;

  const [tenants, homeChapter, chapters] = await Promise.all([
    listImportTargets({ uid: guard.uid || null, tenantId }),
    homeChapterNameOf(tenantId),
    fetchAllRows<{ name: string }>("chapters", "name", {
      eq: [["tenant_id", tenantId]],
      order: { column: "name" },
      pageSize: 1000,
    }).catch(() => [] as { name: string }[]),
  ]);

  return (
    <div>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub muted">Chapters and the Home Chapter. The chapter of an import is read from its file.</p>
      </div>
      <SettingsPanel
        tenants={tenants}
        activeId={tenantId}
        homeChapter={homeChapter}
        chapterNames={chapters.map((c) => c.name)}
      />
    </div>
  );
}
