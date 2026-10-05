import { createTtlCache, sharedState } from "../cache";
import { getSlipsData, type SlipsData } from "./snapshot";

// The snapshot is identical for every question and only changes on import:
// cache per process for 90 seconds so follow-up questions skip ~1s of queries.
// sharedState: the import route and the chat-generate route are separate
// module graphs — clearing must hit the one the generate route reads.
// Keyed by tenant: one chapter's snapshot must never answer another's chat.
const caches = sharedState(
  "chat.snapshotByTenant",
  () => new Map<string, ReturnType<typeof createTtlCache<SlipsData>>>(),
);

function cacheFor(tenantId: string): ReturnType<typeof createTtlCache<SlipsData>> {
  let c = caches.get(tenantId);
  if (!c) {
    c = createTtlCache<SlipsData>(90 * 1000);
    caches.set(tenantId, c);
  }
  return c;
}

/** Snapshot + member×week query index for one tenant, built together in one DB pass. */
export const getCachedSlipsData = (tenantId: string): Promise<SlipsData> =>
  cacheFor(tenantId).get(() => getSlipsData(tenantId));

/** Drop every tenant's cached snapshot (call on import). */
export const clearSlipsSnapshotCache = (): void => caches.clear();
