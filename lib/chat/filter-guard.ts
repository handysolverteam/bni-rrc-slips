/**
 * Server-side guard for the chat tools' optional filters. The model is told to filter by the
 * home chapter / active status only when the question calls for it, but it sometimes adds them
 * anyway (e.g. "who gave the most referrals in the last 4 weeks" answered for active members only).
 * A filter the question gives no cue for is dropped here, so the answer cannot silently narrow.
 */

const ACTIVE_CUE = /\b(active|current|currently)\b/i;
const INACTIVE_CUE = /\binactive\b/i;
// our own chapter, or a who-did-NOT / zero-activity list (only meaningful for our roster)
const HOME_CUE =
  /\b(home|our|ours|we|us|my)\b|influencer|\b(0|zero|no|not|never|without|none|nobody|didn't|didnt|haven't|havent|hasn't|hasnt|missing|absent)\b|\b(active|inactive)\b/i;
const HOME_VALUE = /^(home|our|my|this)(\s+chapter)?$/i;

const norm = (s: string) => s.toLowerCase().replace(/^bni\s+/, "").replace(/s\b/g, "").replace(/[^a-z]/g, "");

export function guardFilters(args: unknown, cueText: string, homeChapter: string): unknown {
  if (!args || typeof args !== "object") return args;
  const a = { ...(args as Record<string, unknown>) };
  if (a.status === "active" && !ACTIVE_CUE.test(cueText)) {
    // "who did NOT …" lists are about the active roster by convention
    if (!HOME_CUE.test(cueText) || !/\b(0|zero|no|not|never|without|none|nobody|didn't|didnt|haven't|havent)\b/i.test(cueText)) delete a.status;
  }
  if (a.status === "inactive" && !INACTIVE_CUE.test(cueText)) delete a.status;
  if (typeof a.chapter === "string") {
    const v = a.chapter.trim();
    const isHome = HOME_VALUE.test(v) || norm(v) === norm(homeChapter);
    if (isHome && !HOME_CUE.test(cueText)) delete a.chapter;
  }
  return a;
}
