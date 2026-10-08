/** Re-import skip for the week-slips import. A row is a duplicate when its
    file-derived identity already exists among this tenant's slips for the
    SAME week — a re-import then drops it instead of inserting a 2nd copy.
    Within one file every entry is still kept (identical rows all import),
    because in-file duplicates never match an existing row on a first import.
    Pure module with zero imports on purpose (compiled standalone in tests). */

export type SlipTable = "slip_referrals" | "slip_one_to_ones" | "slip_tyfcb" | "slip_visitors" | "slip_ceus";

/** The identity fields per table: everything a report row IS, excluding ids,
    member links and batch tags, so the same file row re-imported later
    produces the same signature. */
export const SIG_FIELDS: Record<SlipTable, string[]> = {
  slip_referrals: [
    "from_name",
    "to_name",
    "other_chapter_member",
    "inside_outside",
    "from_is_other_chapter",
    "to_is_other_chapter",
  ],
  slip_one_to_ones: [
    "initiated_by_name",
    "met_with_name",
    "other_chapter_member",
    "initiated_by_is_other_chapter",
    "met_with_is_other_chapter",
  ],
  slip_tyfcb: ["member_name", "amount", "other_chapter_member", "thanker_name", "thanker_is_other_chapter"],
  slip_visitors: ["full_name", "invited_by_name"],
  slip_ceus: ["member_name", "credits"],
};

/** Join with a control separator (never a printable char, so commas and
    numbers can't collide); `null`/`""` hash identically. */
export function rowSignature(table: SlipTable, row: Record<string, unknown>): string {
  return (SIG_FIELDS[table] ?? []).map((f) => String(row[f] ?? "")).join("\u001f");
}

/** Drop payload rows whose signature already exists among the week's rows.
    Only the EXISTING set is consulted, so two copies of the same row inside
    one file both import. Returns the rows to insert + the skip count. */
export function dropDuplicates<T extends Record<string, unknown>>(
  table: SlipTable,
  rows: T[],
  existingKeys: Set<string>,
): { fresh: T[]; duplicateCount: number } {
  const fresh: T[] = [];
  let duplicateCount = 0;
  for (const r of rows) {
    if (existingKeys.has(rowSignature(table, r))) duplicateCount++;
    else fresh.push(r);
  }
  return { fresh, duplicateCount };
}