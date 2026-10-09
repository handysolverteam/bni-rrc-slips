/**
 * Chapter detection for uploaded BNI files (slips report + PALMS). Pure, no
 * imports — compiled standalone in tests/unit-file-chapter.mjs.
 *
 * Both exports carry the chapter in a small header block: a cell that says
 * "Chapter" with the name in the cell BELOW it (PALMS: Z2 "Chapter" / Z3
 * "Influencers") or, for parameter rows, to the RIGHT of it (PALMS: A5
 * "Chapter" ... N5 "Influencers"). The file says "Influencers"; the app calls
 * the chapter "BNI Influencers" — see normalizeChapterName / chapterKey.
 */

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const labelKey = (v: unknown): string => clean(v).replace(/[►▸:]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Header-block labels that are never a chapter name. */
const LABELS = new Set([
  "country",
  "region",
  "parameters",
  "from",
  "to",
  "first name",
  "last name",
  "running user",
  "run at",
  "chapter",
]);

/**
 * The chapter named in the file's header block, or null. Scans the first
 * `maxRows` rows for a cell that is exactly "Chapter" (so "Chapter ► PALMS
 * Attendance Report" and "Other Member's Chapter" never match) and returns the
 * cell below it, else the first real value to its right. Pass only the rows
 * ABOVE the data table's header row so a "Chapter" data column can't match.
 */
export function findChapterName(matrix: unknown[][], maxRows = 25): string | null {
  const rows = matrix.slice(0, maxRows);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (labelKey(row[c]) !== "chapter") continue;
      const below = clean((rows[r + 1] ?? [])[c]);
      if (below && !LABELS.has(labelKey(below))) return below;
      for (let c2 = c + 1; c2 < row.length; c2++) {
        const v = clean(row[c2]);
        if (v && !LABELS.has(labelKey(v))) return v;
      }
    }
  }
  return null;
}

/** "Influencers" -> "BNI Influencers"; "BNI Pioneers, Faridabad, India" -> "BNI Pioneers". */
export function normalizeChapterName(raw: string | null | undefined): string {
  const first = clean(raw).split(",")[0].trim();
  if (!first) return "";
  return /^bni\b/i.test(first) ? first : `BNI ${first}`;
}

/** Comparison key: first comma part, lower-case, no leading "BNI", punctuation-free. */
export function chapterKey(raw: string | null | undefined): string {
  return clean(raw)
    .split(",")[0]
    .toLowerCase()
    .replace(/^bni\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
