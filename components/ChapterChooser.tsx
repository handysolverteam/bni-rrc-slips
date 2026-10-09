"use client";

import { useState } from "react";

export type ChapterOption = { id: string; name: string };

/** Mirrors lib/chapter-target.ts ChapterCheck (what the preview endpoints return). */
export type ChapterCheckInfo = {
  detected: string | null;
  normalized: string;
  status: "match" | "undetected" | "choose";
  active: ChapterOption;
  options: ChapterOption[];
  suggestedId: string | null;
};

const NEW = "__new__";

/** The `chapter` form value for a chooser selection ("" = the active chapter). */
export function chapterField(check: ChapterCheckInfo | undefined, tenantId: string, newName: string): string {
  if (!check || check.status !== "choose") return "";
  if (tenantId === NEW) return newName.trim() ? JSON.stringify({ newName: newName.trim() }) : "";
  return tenantId && tenantId !== check.active.id ? JSON.stringify({ tenantId }) : "";
}

/** The chooser's starting selection — also what the import uses if the user never touches it. */
export function initialChapterField(check: ChapterCheckInfo | undefined): string {
  if (!check || check.status !== "choose") return "";
  const t = check.suggestedId ?? (check.detected ? NEW : check.active.id);
  return chapterField(check, t, check.normalized);
}

/**
 * Which chapter a file belongs to. The file names it ("Influencers" -> "BNI
 * Influencers"): when that is the active chapter nothing is asked; when it is
 * unclear the user picks an existing chapter or types a new one.
 */
export default function ChapterChooser({
  check,
  disabled,
  onChange,
}: {
  check: ChapterCheckInfo;
  disabled?: boolean;
  /** Called with the new `chapter` form value whenever the selection changes. */
  onChange: (field: string) => void;
}) {
  const initial = check.suggestedId ?? (check.detected ? NEW : check.active.id);
  const [tenantId, setTenantId] = useState(initial);
  const [newName, setNewName] = useState(check.normalized);

  if (check.status === "match") {
    return <p className="preview-ok">Chapter: {check.active.name} ✓ (matches the file)</p>;
  }
  if (check.status === "undetected") {
    return <p className="preview-note">No chapter found in the file — importing into {check.active.name}.</p>;
  }

  const emit = (t: string, n: string) => onChange(chapterField(check, t, n));
  return (
    <div className="chapter-chooser preview-note">
      <p>
        This file is for <strong>{check.detected}</strong>, which is not the selected chapter. Choose where to import it:
      </p>
      <div className="chapter-chooser-row">
        <select
          aria-label="Import into chapter"
          value={tenantId}
          disabled={disabled}
          onChange={(e) => {
            setTenantId(e.target.value);
            emit(e.target.value, newName);
          }}
        >
          {check.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={NEW}>＋ Add a new chapter…</option>
        </select>
        {tenantId === NEW ? (
          <input
            aria-label="New chapter name"
            placeholder="New chapter name"
            value={newName}
            disabled={disabled}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => emit(tenantId, newName)}
          />
        ) : null}
      </div>
    </div>
  );
}
