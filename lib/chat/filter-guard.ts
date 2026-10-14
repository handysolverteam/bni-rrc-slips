/**
 * Server-side enforcement of the chat's DEFAULT filters. Unless the member's own words ask otherwise,
 * every member-level query is limited to the HOME chapter's ACTIVE members. The model can only widen
 * that (other chapters / inactive / everyone) when the question — or one of their last few — says so:
 *   - other chapters: "all chapters", "other chapters", a named chapter, …
 *   - inactive only:  "inactive members …"
 *   - everyone:       "including inactive", "active and inactive", "all members", …
 * A query that names a specific member is never filtered (a lookup of an inactive or other-chapter
 * member must still answer; the answer then says "Member: …").
 */

const ALL_CHAPTERS_CUE =
  /\ball\s+(the\s+)?chapters?\b|\bother\s+(bni\s+)?chapters?\b|\bevery\s+chapter\b|\bacross\s+(all\s+)?(the\s+)?chapters?\b|\bany\s+chapter\b|\boutside\s+(of\s+)?(our|the|this)\s+(home\s+)?chapter\b|\ball\s+bni\b|\bwhole\s+network\b|\bimported\s+members\b/i;
const INACTIVE_CUE = /\binactive\b/i;
const EVERYONE_CUE =
  /\b(including|include|incl\.?|plus|with)\s+(the\s+)?inactive\b|\bactive\s+(and|&|or|\+)\s+inactive\b|\binactive\s+(and|&|or|\+)\s+active\b|\bboth\s+active\b|\ball\s+members\b|\bevery\s+member\b|\bregardless\s+of\b|\b(whole|entire)\s+roster\b|\bany\s+status\b/i;

const norm = (s: string) => s.toLowerCase().replace(/^bni\s+/, "").replace(/s\b/g, "").replace(/[^a-z]/g, "");
const isHomeValue = (v: string, home: string) => /^(home|our|my|this)(\s+chapter)?$/i.test(v.trim()) || norm(v) === norm(home);
const isAllValue = (v: string) => /^(all|any|every)(\s+chapters?)?$/i.test(v.trim());

export function guardFilters(args: unknown, cueText: string, homeChapter: string): unknown {
  if (!args || typeof args !== "object") return args;
  const a = { ...(args as Record<string, unknown>) };
  const named =
    (Array.isArray(a.members) && a.members.some((m) => typeof m === "string" && m.trim() !== "")) ||
    (typeof a.member === "string" && a.member.trim() !== "");
  if (named) {
    // A named lookup is unfiltered, whatever the model passed.
    delete a.chapter;
    delete a.status;
    return a;
  }
  // chapter: a named OTHER chapter stays only when the question mentions it.
  const passed = typeof a.chapter === "string" ? a.chapter.trim() : "";
  const namesOther =
    passed !== "" && !isHomeValue(passed, homeChapter) && !isAllValue(passed) && cueText.toLowerCase().includes(passed.toLowerCase().replace(/^bni\s+/, "").split(/[ ,]/)[0]);
  if (!namesOther) a.chapter = ALL_CHAPTERS_CUE.test(cueText) ? "all" : "home";
  // status
  if (EVERYONE_CUE.test(cueText)) a.status = "any";
  else if (INACTIVE_CUE.test(cueText)) a.status = "inactive";
  else a.status = "active";
  return a;
}
