/**
 * Ties at the cut-off of a "top N" list. Pure module with zero imports on purpose (inlined by tests).
 *
 * "Top 3" means the three best places, not exactly three people: when several members share the value of the LAST listed
 * one, all of them are shown.
 */

/**
 * The first `n` items of a list sorted best-first, plus every following item whose value equals the n-th item's value.
 * No extension when the list has at most `n` items or when the cut-off value is 0 (zero is "did nothing", not a place:
 * a top-3 with only two active members must not drag in the whole roster).
 */
export function withTies<T>(sorted: T[], n: number, value: (item: T) => number): T[] {
  if (n <= 0) return [];
  if (sorted.length <= n) return sorted.slice();
  const cut = value(sorted[n - 1]);
  if (!Number.isFinite(cut) || cut === 0) return sorted.slice(0, n);
  let end = n;
  while (end < sorted.length && value(sorted[end]) === cut) end++;
  return sorted.slice(0, end);
}

/** Competition ranks of a best-first list of values: equal values share a rank (10, 8, 8, 5 -> 1, 2, 2, 4). */
export function competitionRanks(values: number[]): number[] {
  return values.map((v, i) => (i > 0 && v === values[i - 1] ? 0 : i + 1)).reduce<number[]>((ranks, r, i) => {
    ranks.push(r === 0 ? ranks[i - 1] : r);
    return ranks;
  }, []);
}
