/**
 * A filter value may itself contain commas (chapter names: "Champions, Gurgaon, India"), but the
 * URL joins multi-selects with ",". So a comma INSIDE one option is carried as U+201A (a low
 * quote that looks like a comma) and turned back into a real comma where the value is used.
 */
export const COMMA_IN_VALUE = "‚";
export const encodeCommas = (v: string): string => v.replace(/,/g, COMMA_IN_VALUE);
export const decodeCommas = (v: string): string => v.split(COMMA_IN_VALUE).join(",");

/** Split a comma-separated multi-select value into trimmed, non-empty parts (commas inside a value restored). */
export function multiParts(value: string): string[] {
  return value.split(",").map((s) => decodeCommas(s.trim())).filter(Boolean);
}

/**
 * Header-filter value of the chapter columns ("Other Member's Chapter", "Thanking Member's Chapter") that stands for
 * "the HOME chapter": those cells are blank when the other person belongs to the home chapter.
 */
export const HOME_CHAPTER_VALUE = "__home__";

/** The first option of a chapter column's filter: "Home Chapter (BNI Influencers)". */
export const homeChapterOption = (homeName: string): { value: string; label: string } => ({
  value: HOME_CHAPTER_VALUE,
  label: homeName.trim() ? `Home Chapter (${homeName.trim()})` : "Home Chapter",
});

type Filterable = {
  ilike(column: string, pattern: string): unknown;
  in(column: string, values: (string | number)[]): unknown;
  or(filters: string): unknown;
};

/**
 * In-memory twin of the HOME_CHAPTER_VALUE handling, for rows that are already loaded (the Slip Report): `terms` are the
 * lower-cased picks; the home pick matches a blank cell, any other pick matches when the cell contains it.
 */
export function matchesChapterFilter(cell: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = cell.trim().toLowerCase();
  return terms.some((t) => (t === HOME_CHAPTER_VALUE ? hay === "" : hay.includes(t)));
}

/** A value inside a PostgREST `in.(…)` list: double-quoted, so commas / parentheses in chapter names are safe. */
const quoteForIn = (v: string): string => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

type WeekFilterable = {
  eq(column: string, value: unknown): unknown;
  in(column: string, values: (string | number)[]): unknown;
};

/**
 * Apply a column filter value to a query. A single value keeps the old fuzzy
 * ilike match; several (comma-separated) values OR-match exactly via IN —
 * multi picks come from distinct-value dropdowns, where options are exact
 * values. The HOME_CHAPTER_VALUE pick matches the blank cells (NULL or ''),
 * alone or OR-ed with the other picked values.
 */
export function applyColumnFilter<Q extends Filterable>(
  query: Q,
  column: string,
  value: string,
): Q {
  const parts = multiParts(value);
  if (parts.includes(HOME_CHAPTER_VALUE)) {
    const rest = parts.filter((p) => p !== HOME_CHAPTER_VALUE);
    const conds = [`${column}.is.null`, `${column}.eq.`];
    if (rest.length > 0) conds.push(`${column}.in.(${rest.map(quoteForIn).join(",")})`);
    return query.or(conds.join(",")) as Q;
  }
  if (parts.length === 1) return query.ilike(column, `%${parts[0]}%`) as Q;
  return query.in(column, parts) as Q;
}

/**
 * Apply the list-week scope value ("id" or a comma-separated "id1,id2")
 * as an equality or IN filter on bni_week_id.
 */
export function applyWeekFilter<Q extends WeekFilterable>(
  query: Q,
  weekId: string,
): Q {
  const ids = multiParts(weekId);
  if (ids.length === 1) return query.eq("bni_week_id", ids[0]) as Q;
  return query.in("bni_week_id", ids) as Q;
}