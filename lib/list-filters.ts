/** Split a comma-separated multi-select value into trimmed, non-empty parts. */
export function multiParts(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

type Filterable = {
  ilike(column: string, pattern: string): unknown;
  in(column: string, values: (string | number)[]): unknown;
};

type WeekFilterable = {
  eq(column: string, value: unknown): unknown;
  in(column: string, values: (string | number)[]): unknown;
};

/**
 * Apply a column filter value to a query. A single value keeps the old fuzzy
 * ilike match; several (comma-separated) values OR-match exactly via IN —
 * multi picks come from distinct-value dropdowns, where options are exact
 * values.
 */
export function applyColumnFilter<Q extends Filterable>(
  query: Q,
  column: string,
  value: string,
): Q {
  const parts = multiParts(value);
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