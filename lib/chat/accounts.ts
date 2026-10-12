import { sharedState } from "@/lib/cache";
import { lookupFirebaseUsers } from "@/lib/firebase/admin";

export type Account = { name: string | null; email: string | null };

type Entry = { at: number; value: Account | null };
const store = sharedState("chat.accounts", () => new Map<string, Entry>());

/** A found account is remembered for an hour; a miss / failed lookup is retried after a minute. */
const HIT_MS = 60 * 60_000;
const MISS_MS = 60_000;

/** The account's display name, else its e-mail (what the chat shows as "who"). */
export const accountLabel = (a: Account | null | undefined): string => a?.name?.trim() || a?.email?.trim() || "";

/**
 * Who the given Firebase uids are (name + e-mail), cached in memory. Never
 * throws: when the lookup is unavailable the uid is simply missing from the
 * result and callers fall back to a short id.
 */
export async function accountsFor(uids: string[]): Promise<Map<string, Account>> {
  const now = Date.now();
  const unique = [...new Set(uids.filter(Boolean))];
  const need = unique.filter((u) => {
    const e = store.get(u);
    return !e || now - e.at > (e.value ? HIT_MS : MISS_MS);
  });
  if (need.length > 0) {
    try {
      const found = await lookupFirebaseUsers(need);
      for (const u of need) store.set(u, { at: now, value: found.get(u) ?? null });
    } catch {
      for (const u of need) store.set(u, { at: now, value: store.get(u)?.value ?? null });
    }
  }
  const out = new Map<string, Account>();
  for (const u of unique) {
    const v = store.get(u)?.value;
    if (v) out.set(u, v);
  }
  return out;
}
