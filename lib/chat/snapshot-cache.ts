import { createTtlCache, sharedState } from "../cache";
import { getSlipsSnapshot, type SlipsSnapshot } from "./snapshot";

// The snapshot is identical for every question and only changes on import:
// cache per process for 90 seconds so follow-up questions skip ~1s of queries.
// sharedState: the import route and the chat-generate route are separate
// module graphs — clearing must hit the one the generate route reads.
const cache = sharedState("chat.snapshot", () => createTtlCache<SlipsSnapshot>(90 * 1000));

export const getCachedSlipsSnapshot = (): Promise<SlipsSnapshot> =>
  cache.get(() => getSlipsSnapshot());

export const clearSlipsSnapshotCache = (): void => cache.clear();
