import { createTtlCache } from "../cache";
import { getSlipsSnapshot, type SlipsSnapshot } from "./snapshot";

// The snapshot is identical for every question and only changes on import:
// cache per process for 90 seconds so follow-up questions skip ~1s of queries.
const cache = createTtlCache<SlipsSnapshot>(90 * 1000);

export const getCachedSlipsSnapshot = (): Promise<SlipsSnapshot> =>
  cache.get(() => getSlipsSnapshot());

export const clearSlipsSnapshotCache = (): void => cache.clear();
