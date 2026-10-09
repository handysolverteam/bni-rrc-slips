/**
 * Member-name merging, pure part (no imports — compiled standalone in
 * tests/unit-alias-map.mjs). A person can appear under several spellings
 * ("Amit Bahl", "Amit K Bahl", "A. Bahl"); a remembered merge maps the
 * alias spelling to one canonical name so imports treat them as one member.
 */

export const nameKey = (n: string): string => n.replace(/\s+/g, " ").trim().toLowerCase();

/** alias key -> canonical name (display spelling). */
export type AliasMap = Map<string, string>;

/** Follow alias -> canonical (up to a few hops, cycle-safe). */
export function resolveAlias(map: AliasMap, name: string): string {
  let cur = name.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 5; i++) {
    const next = map.get(nameKey(cur));
    if (!next || nameKey(next) === nameKey(cur)) return cur;
    cur = next;
  }
  return cur;
}

type SlipRowLike = { from: string; to: string; slipType: string };

/**
 * Report rows with member names mapped to their canonical spelling. The
 * visitor's own name (To of a Visitor slip) is a guest, never a member, so it
 * is left alone; every other From/To is a member name.
 */
export function aliasReportRows<T extends SlipRowLike>(rows: T[], map: AliasMap): T[] {
  if (map.size === 0) return rows;
  return rows.map((r) => {
    const visitor = r.slipType.toLowerCase().includes("visitor");
    const from = r.from ? resolveAlias(map, r.from) : r.from;
    const to = r.to && !visitor ? resolveAlias(map, r.to) : r.to;
    return from === r.from && to === r.to ? r : { ...r, from, to };
  });
}

type PalmsMemberLike = { name: string; cells: (string | null)[] };

/** PALMS members mapped to canonical names; two spellings of one person merge into one row (first letter per week wins). */
export function aliasPalmsMembers<T extends PalmsMemberLike>(members: T[], map: AliasMap): T[] {
  if (map.size === 0) return members;
  const out = new Map<string, T>();
  for (const m of members) {
    const name = resolveAlias(map, m.name);
    const k = nameKey(name);
    const have = out.get(k);
    if (!have) {
      out.set(k, name === m.name ? m : { ...m, name, cells: [...m.cells] });
    } else {
      have.cells = have.cells.map((c, i) => c ?? m.cells[i] ?? null);
    }
  }
  return [...out.values()];
}

// ---- "looks like the same person" suggestions --------------------------------

const tok = (n: string): string[] =>
  n.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const close = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1);

/**
 * 0 = unrelated; 3 = same first + last name apart from a middle name, an
 * initial or a one-letter typo; 2 = one name's words all appear in the other.
 * Identical names score 0 (they are the same member, nothing to merge).
 */
export function similarScore(a: string, b: string): number {
  const ta = tok(a);
  const tb = tok(b);
  if (ta.length < 2 || tb.length < 2) return 0;
  if (ta.join(" ") === tb.join(" ")) return 0;
  const firstSame =
    close(ta[0], tb[0]) || ((ta[0].length === 1 || tb[0].length === 1) && ta[0][0] === tb[0][0]);
  if (firstSame && close(ta[ta.length - 1], tb[tb.length - 1])) return 3;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.every((t) => long.includes(t))) return 2;
  return 0;
}

/** Up to 3 existing names that may be the same person as `name`. */
export function findSimilar(name: string, existing: string[]): string[] {
  return existing
    .map((e) => ({ e, s: similarScore(name, e) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.e.localeCompare(y.e))
    .slice(0, 3)
    .map((x) => x.e);
}

/** `mergeMembers` form value: JSON object { aliasName: canonicalName } (junk dropped). */
export function parseMergePicks(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && k.trim() && v.trim() && nameKey(k) !== nameKey(v)) out[k.trim()] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}
