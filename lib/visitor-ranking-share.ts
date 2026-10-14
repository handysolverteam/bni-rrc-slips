import { whatsappShareUrl } from "@/lib/whatsapp";

/** One member and how many visitors they brought in the chosen months. */
export type RankEntry = { name: string; count: number };

/** Per-period visitor counts: period key (a meeting date `YYYY-MM-DD`) -> inviter name -> visitors. */
export type MonthCounts = Record<string, Record<string, number>>;

/**
 * Sum the picked months per inviter (names merge case-insensitively and keep their first spelling) and
 * order LEAST to MOST, then by name. Only members with at least one visitor appear.
 */
export function mergeRanking(counts: MonthCounts, keys: string[]): RankEntry[] {
  const sums = new Map<string, RankEntry>();
  for (const key of keys) {
    for (const [raw, n] of Object.entries(counts[key] ?? {})) {
      const name = raw.replace(/\s+/g, " ").trim();
      if (!name || !Number.isFinite(n) || n <= 0) continue;
      const k = name.toLowerCase();
      const prev = sums.get(k);
      if (prev) prev.count += n;
      else sums.set(k, { name, count: n });
    }
  }
  return [...sums.values()].sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
}

/**
 * Does a visitor count satisfy what was typed in the Visitors filter box? Terms are separated by commas or
 * spaces and OR-ed: `3` (exactly 3), `>2`, `>=3`, `<5`, `<=4`, `2-4` (inclusive range). Blank = no filter;
 * text that holds no valid term matches nothing (so a typo never silently shows everything).
 */
export function matchesCount(spec: string, n: number): boolean {
  const terms = spec.split(/[\s,]+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((t) => {
    let m = /^(>=|<=|>|<|=)?(\d+)$/.exec(t);
    if (m) {
      const v = Number(m[2]);
      switch (m[1]) {
        case ">":
          return n > v;
        case ">=":
          return n >= v;
        case "<":
          return n < v;
        case "<=":
          return n <= v;
        default:
          return n === v;
      }
    }
    m = /^(\d+)-(\d+)$/.exec(t);
    return !!m && n >= Math.min(Number(m[1]), Number(m[2])) && n <= Math.max(Number(m[1]), Number(m[2]));
  });
}

/** Apply the two column filters: Member (exact names, case-insensitive) and Visitors (see matchesCount). */
export function filterRanking(ranking: RankEntry[], members: string[], countSpec: string): RankEntry[] {
  const want = new Set(members.map((m) => m.trim().toLowerCase()).filter(Boolean));
  return ranking.filter((r) => (want.size === 0 || want.has(r.name.toLowerCase())) && matchesCount(countSpec, r.count));
}

/** Home chapter's active members who brought nobody in the picked months. */
export function namesWithNone(pool: string[], ranking: RankEntry[]): string[] {
  const have = new Set(ranking.map((r) => r.name.toLowerCase()));
  return pool.filter((n) => !have.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b));
}

/**
 * WhatsApp text (same rules as lib/monthly-top-share.ts: bold headings with *...*, only symbols from the
 * basic multilingual plane — emoji arrive as "?" on WhatsApp for Windows). Grouped by count, least to most.
 */
export function buildRankingShare(label: string, ranking: RankEntry[], none: string[]): string {
  const groups = new Map<number, string[]>();
  for (const r of ranking) groups.set(r.count, [...(groups.get(r.count) ?? []), r.name]);
  const total = ranking.reduce((s, r) => s + r.count, 0);
  const blocks = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([count, names]) => `◆ *${count} visitor${count === 1 ? "" : "s"}* (${names.length})\n${names.join(", ")}`);
  return [
    `★ *Visitors brought · ${label}*`,
    "Least to most",
    ...(blocks.length > 0 ? blocks : ["No visitors recorded."]),
    `Total: ${total} visitor${total === 1 ? "" : "s"} from ${ranking.length} member${ranking.length === 1 ? "" : "s"}`,
    ...(none.length > 0 ? [`✗ *Brought none* (${none.length})\n${none.join(", ")}`] : []),
  ].join("\n\n");
}

export const rankingShareUrl = (text: string): string => whatsappShareUrl(text);
