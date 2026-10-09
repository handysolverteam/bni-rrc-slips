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

/** The chapter named in the file when it does not exist yet (created on import). */
const FILE = "__file__";
/** A chapter name the user types. */
const NEW = "__new__";

/** The `chapter` form value for a selection. An explicit pick is never "" (even the active chapter) so the panels can tell it from "not touched yet". */
export function chapterField(check: ChapterCheckInfo | undefined, selection: string, newName: string): string {
  if (!check) return "";
  if (selection === FILE) return check.normalized ? JSON.stringify({ newName: check.normalized }) : "";
  if (selection === NEW) return newName.trim() ? JSON.stringify({ newName: newName.trim() }) : "";
  return selection ? JSON.stringify({ tenantId: selection }) : "";
}

/** What the dropdown starts on: the file's chapter (existing → that chapter, new → created from the file), else the active one. */
function startSelection(check: ChapterCheckInfo): string {
  return check.suggestedId ?? (check.detected ? FILE : check.active.id);
}

/** The starting `chapter` form value — also what the import uses if the user never touches the dropdown. */
export function initialChapterField(check: ChapterCheckInfo | undefined): string {
  if (!check) return "";
  const start = startSelection(check);
  // Untouched + active chapter = no explicit choice ("" = import into the active chapter).
  return start === check.active.id ? "" : chapterField(check, start, check.normalized);
}

/**
 * Which chapter this file is imported into — shown for EVERY import. It starts
 * on the chapter named in the file ("Influencers" = BNI Influencers; a chapter
 * the app does not know yet is offered as "<name> (from file)" and created on
 * import). The user can pick any other chapter they belong to, or type a new
 * chapter name.
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
  const [selection, setSelection] = useState(startSelection(check));
  const [newName, setNewName] = useState("");

  const emit = (s: string, n: string) => onChange(chapterField(check, s, n));
  const fileOnly = check.detected && !check.suggestedId;

  return (
    <div className="chapter-chooser">
      <span className="filter-label">Import into chapter</span>
      <div className="chapter-chooser-row">
        <select
          aria-label="Import into chapter"
          value={selection}
          disabled={disabled}
          onChange={(e) => {
            setSelection(e.target.value);
            emit(e.target.value, newName);
          }}
        >
          {check.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {check.suggestedId === o.id ? " — from the file" : ""}
            </option>
          ))}
          {fileOnly ? (
            <option value={FILE}>{check.normalized} — from the file (new chapter)</option>
          ) : null}
          <option value={NEW}>＋ Type a new chapter name…</option>
        </select>
        {selection === NEW ? (
          <input
            aria-label="New chapter name"
            placeholder="New chapter name"
            value={newName}
            disabled={disabled}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => emit(selection, newName)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                emit(selection, newName);
              }
            }}
          />
        ) : null}
      </div>
      <p className="muted chapter-chooser-hint">
        {check.detected
          ? `The file says “${check.detected}”${check.normalized !== check.detected ? ` → ${check.normalized}` : ""}.`
          : "No chapter found in the file."}{" "}
        Change it here if it is wrong.
      </p>
    </div>
  );
}
