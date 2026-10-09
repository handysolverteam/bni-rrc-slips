import NoAccess from "@/components/NoAccess";
import { fetchOtherChapters, type OtherChapter } from "@/lib/chapter-members";
import { requirePageTenant } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ChaptersPage() {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;

  let chapters: OtherChapter[] = [];
  try {
    chapters = await fetchOtherChapters(guard.tenantId);
  } catch {
    chapters = [];
  }
  const totalMembers = chapters.reduce((n, c) => n + c.total, 0);

  return (
    <div>
      <div className="page-head">
        <h1>
          Other Chapters
          <span className="count-badge">{chapters.length} chapter(s)</span>
        </h1>
        <p className="sub muted">
          {totalMembers.toLocaleString("en-IN")} member(s) from other chapters — largest chapter first. Click a row to see
          its members.
        </p>
      </div>

      <div className="card">
        {chapters.length === 0 ? (
          <p className="muted">No members from other chapters yet — they appear after a slip import.</p>
        ) : (
          <div className="chapter-list">
            <div className="chapter-row chapter-head" aria-hidden="true">
              <span>Chapter</span>
              <span className="chapter-count">Members</span>
            </div>
            {chapters.map((c, i) => (
              <details key={c.id} className="chapter-item">
                <summary className="chapter-row">
                  <span className="chapter-name">
                    <span className="chapter-rank">{i + 1}</span>
                    {c.name}
                  </span>
                  <span className="chapter-count">
                    <strong>{c.total}</strong>
                    {c.inactive > 0 ? <span className="muted"> · {c.inactive} inactive</span> : null}
                  </span>
                </summary>
                <ol className="chapter-members">
                  {c.members.map((m, k) => (
                    <li key={`${m.name}-${k}`} className={m.inactive ? "is-inactive" : undefined}>
                      {m.name}
                      {m.inactive ? <span className="pill outside">Inactive</span> : null}
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
