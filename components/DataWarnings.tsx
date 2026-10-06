import type { MissingFile } from "@/lib/data-health";
import type { WeekComparison } from "@/lib/palms-compare";

const fmt = (key: string, v: number): string =>
  key === "tyfcb" ? v.toLocaleString("en-IN") : String(v);

const MAX_LIST = 8;

/**
 * Data-health banners shared by `/report` and `/summary` (server-rendered) —
 * rendered ONLY when something is wrong (nothing on success):
 * 1. Wednesdays between the first imported meeting and today with no slips file.
 * 2. PALMS-vs-slips mismatches (stored PALMS Total row vs our slip counts).
 */
export default function DataWarnings({
  missing,
  comparisons,
}: {
  missing: MissingFile[];
  comparisons: WeekComparison[];
}) {
  const mismatched = comparisons.filter((c) => !c.allMatch);
  const entries = mismatched.flatMap((c) =>
    c.rows
      .filter((r) => !r.match)
      .map((r) => `${c.weekLabel || "Week"} — ${r.label}: PALMS ${fmt(r.key, r.palms)} vs slips ${fmt(r.key, r.slips)}`),
  );
  if (missing.length === 0 && entries.length === 0) return null;

  const shownEntries = entries.slice(0, MAX_LIST);
  const shownMissing = missing.slice(0, MAX_LIST);

  return (
    <div className="data-alerts">
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
            The meeting date passed but no Slips Audit Report was imported for it — the report and
            chapter summary are incomplete for those weeks.
          </p>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="data-alert bad" role="alert">
          <span className="alert-title">
            {`PALMS vs slips mismatch in ${mismatched.length} week${mismatched.length === 1 ? "" : "s"}`}
          </span>
          <ul>
            {shownEntries.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {entries.length > shownEntries.length ? (
            <p className="alert-sub">+{entries.length - shownEntries.length} more difference(s)</p>
          ) : null}
          <p className="alert-sub">
            Re-import the Slips Audit Report or the PALMS Chapter Summary for the affected week to
            resolve this.
          </p>
        </div>
      ) : null}
    </div>
  );
}
