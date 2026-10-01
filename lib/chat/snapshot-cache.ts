import { createTtlCache, sharedState } from "../cache";
import { getSlipsData, type SlipsData } from "./snapshot";

// The snapshot is identical for every question and only changes on import:
// cache per process for 90 seconds so follow-up questions skip ~1s of queries.
// sharedState: the import route and the chat-generate route are separate
// module graphs — clearing must hit the one the generate route reads.
const cache = sharedState("chat.snapshot", () => createTtlCache<SlipsData>(90 * 1000));

/** Snapshot + member×week query index, built together in one DB pass. */
export const getCachedSlipsData = (): Promise<SlipsData> => cache.get(() => getSlipsData());

export const clearSlipsSnapshotCache = (): void => cache.clear();
