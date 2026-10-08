import type { MissingFile, UnimportedEntry } from "@/lib/data-health";

const MAX_LIST = 8;

/**
 * Data-health banners for `/report` (server-rendered) — rendered ONLY when
 * something is wrong (nothing on success):
 * 1. Wednesdays between the first imported meeting and today with no slips file.
 * 2. Weeks in scope missing their slips file — the red "… not imported yet"
 *    notice.
 * PALMS never appears here: attendance lives on `/palms`, which shows no
 * banners of its own (the two reports are independent).
 */
export default function DataWarnings({
  missing,
  unimported = [],
}: {
  missing: MissingFile[];
  unimported?: UnimportedEntry[];
}) {
  const unimportedLines = unimported.map((u) => `${u.label}: Slips Audit Report not imported yet`);
  if (missing.length === 0 && unimportedLines.length === 0) return null;

  const shownMissing = missing.slice(0, MAX_LIST);
  const shownUnimported = unimportedLines.slice(0, MAX_LIST);

  return (
    <div className="data-alerts">
      {unimportedLines.length > 0 ? (
        <div className="data-alert bad" role="alert">
          <span className="alert-title">
            {`Meeting data not imported yet in ${unimported.length} meeting${unimported.length === 1 ? "" : "s"}`}
          </span>
          <ul>
            {shownUnimported.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {unimportedLines.length > shownUnimported.length ? (
            <p className="alert-sub">+{unimportedLines.length - shownUnimported.length} more</p>
          ) : null}
          <p className="alert-sub">
            Import the missing file from the Import screen.
          </p>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="data-alert warn" role="alert">
          <span className="alert-title">
            {`Missing slip file for ${missing.length} Wednesday meeting${missing.length === 1 ? "" : "s"}`}
          </span>
          <span>
            {shownMissing.map((m) => m.label).join(", ")}
            {missing.length > shownMissing.length ? ` +${missing.length - shownMissing.length} more` : ""}
          </span>
          <p className="alert-sub">
            The meeting date passed but no Slips Audit Report was imported for it — the report is
            incomplete for those weeks.
          </p>
        </div>
      ) : null}
    </div>
  );
}
