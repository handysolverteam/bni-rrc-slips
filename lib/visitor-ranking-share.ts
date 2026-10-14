import { whatsappShareUrl } from "@/lib/whatsapp";

/** One member and how many visitors they brought in the chosen months. */
export type RankEntry = { name: string; count: number };

/** Per-month visitor counts: month key (`YYYY-MM`) -> inviter name -> visitors. */
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
