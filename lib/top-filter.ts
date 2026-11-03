/**
 * Member filters of the Top 3 screen: status (active / inactive) and chapter, both multi-select. DEFAULT = active members of
 * the Home Chapter (the same rule as the chat); "all" in a box removes that restriction. Pure module with zero imports on
 * purpose (compiled standalone in tests).
 *
 * The slips only store member NAMES, so the filter works on names: a name passes when SOME member row of that name has a
 * matching status and chapter. Chapters are identified by id (chapter names can contain commas, the URL list cannot).
 */
export type TopStatus = "active" | "inactive";

/** One row of the `members` table (a name can exist in several chapters). */
export type TopMember = { name: string; inactive: boolean; chapterId: string };

/** `null` = no restriction on that axis. */
export type TopFilter = { statuses: TopStatus[] | null; chapters: string[] | null };

export const ALL_MEMBERS: TopFilter = { statuses: null, chapters: null };

export const nameKey = (n: string | null | undefined): string => String(n ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const STATUSES: TopStatus[] = ["active", "inactive"];

/**
 * `?status=` (`active` | `inactive` | `active,inactive` | `all`) and `?chapter=` (chapter ids, comma list, or `all`).
 * Absent / unreadable values mean the default: active members, Home Chapter (`homeChapterId`; no restriction when the
 * Home Chapter has no members yet).
 */
export function parseTopFilter(sp: { status?: string; chapter?: string }, homeChapterId: string | null, knownChapterIds: string[] = []): TopFilter {
  const rawStatus = (sp.status ?? "").trim().toLowerCase();
  let statuses: TopStatus[] | null = ["active"];
  if (rawStatus === "all") statuses = null;
  else if (rawStatus) {
    const picked = rawStatus.split(",").map((s) => s.trim()).filter((s): s is TopStatus => STATUSES.includes(s as TopStatus));
    if (picked.length >= 2) statuses = null; // both = everybody
    else if (picked.length === 1) statuses = picked;
  }

  const rawChapter = (sp.chapter ?? "").trim();
  let chapters: string[] | null = homeChapterId ? [homeChapterId] : null;
  if (rawChapter.toLowerCase() === "all") chapters = null;
  else if (rawChapter) {
    const known = new Set(knownChapterIds);
    const picked = rawChapter.split(",").map((s) => s.trim()).filter((s) => s && (known.size === 0 || known.has(s)));
    if (picked.length > 0) chapters = picked;
  }
  return { statuses, chapters };
}

/** Is `name` one of the members the filter lets through? With no restriction at all every name passes (also non-members). */
export function makeNameMatcher(members: TopMember[], filter: TopFilter): (name: string | null | undefined) => boolean {
  if (!filter.statuses && !filter.chapters) return () => true;
  const allowed = new Set<string>();
  for (const m of members) {
    const status: TopStatus = m.inactive ? "inactive" : "active";
    if (filter.statuses && !filter.statuses.includes(status)) continue;
    if (filter.chapters && !filter.chapters.includes(m.chapterId)) continue;
    allowed.add(nameKey(m.name));
  }
  return (name) => allowed.has(nameKey(name));
}

/** True when the filter is the default (active + Home Chapter), i.e. nothing for "Clear all" to reset. */
export function isDefaultTopFilter(filter: TopFilter, homeChapterId: string | null): boolean {
  const statusDefault = !!filter.statuses && filter.statuses.length === 1 && filter.statuses[0] === "active";
  const chapterDefault = homeChapterId ? !!filter.chapters && filter.chapters.length === 1 && filter.chapters[0] === homeChapterId : filter.chapters === null;
  return statusDefault && chapterDefault;
}

/** "Active members · BNI Influencers", "All members · all chapters", "Inactive members · BNI Influencers + Pratham". */
export function describeTopFilter(filter: TopFilter, chapterName: (id: string) => string): string {
  const who = !filter.statuses ? "All members" : filter.statuses[0] === "active" ? "Active members" : "Inactive members";
  const where = !filter.chapters ? "all chapters" : filter.chapters.map(chapterName).join(" + ");
  return `${who} · ${where}`;
}
