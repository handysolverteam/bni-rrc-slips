/**
 * Process-wide registry for TTL caches. Next.js bundles pages and route
 * handlers into separate module graphs, so a module-level `const cache = ...`
 * gets a SEPARATE instance per graph — clearing from a route handler then
 * silently misses the page's copy and the screen stays stale until TTL.
 * Hanging state off globalThis makes every bundle in the process share one.
 */
export function sharedState<T>(key: string, init: () => T): T {
  const store = globalThis as Record<string, unknown>;
  const bag = (store.__bniSharedState ??= {}) as Record<string, unknown>;
  if (!(key in bag)) bag[key] = init();
  return bag[key] as T;
}

/**
 * Minimal in-memory TTL cache for server-side data that changes rarely
 * (week calendar, chat snapshot). Per-process memory: on multi-instance
 * hosting each instance simply holds its own copy. Callers clear on import.
 *
 * Concurrent cold `get` calls share one in-flight fetch (no stampede).
 * `clear()` bumps a generation so a fetch that was already running cannot
 * commit a stale value after the clear.
 */
export function createTtlCache<T>(ttlMs: number) {
  let at = 0;
  let value: T | null = null;
  let has = false;
  let gen = 0;
  let inflight: Promise<T> | null = null;

  return {
    async get(fetch: () => Promise<T>): Promise<T> {
      if (has && Date.now() - at < ttlMs) return value as T;
      if (inflight) return inflight;
      const g = gen;
      const p: Promise<T> = fetch().then((v) => {
        if (g === gen) {
          value = v;
          at = Date.now();
          has = true;
        }
        return v;
      });
      inflight = p;
      try {
        return await p;
      } finally {
        if (inflight === p) inflight = null;
      }
    },
    clear() {
      has = false;
      value = null;
      at = 0;
      gen++;
      inflight = null;
    },
  };
}

type Keyed = { at: number; value?: unknown; has: boolean; promise?: Promise<unknown> };
const keyed = sharedState("cache.keyed", () => new Map<string, Keyed>());
const keyedGen = sharedState("cache.keyedGen", () => ({ n: 0 }));

/**
 * Per-key TTL cache for server data that only changes when WE write (imports,
 * merges, settings…): every database round trip costs ~350–650ms, so a screen
 * that needs 10 sequential queries used to take seconds even for tiny data.
 * Concurrent cold calls for one key share one in-flight fetch; `clearCached()`
 * (called by clearDistinctCache on every write path) drops everything, and a
 * fetch that was already running cannot store a stale value afterwards.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetch: () => Promise<T>,
  /** Past `ttlMs` but within `staleMs` the old value is returned AT ONCE and refreshed in the background. */
  staleMs = 0,
): Promise<T> {
  const hit = keyed.get(key);
  const age = hit?.has ? Date.now() - hit.at : Infinity;
  if (hit?.has && age < ttlMs) return hit.value as T;
  if (hit?.has && age < ttlMs + staleMs) {
    // stale-while-revalidate: nobody waits for the database after the first view
    if (!hit.promise) void cached(key, 0, fetch).catch(() => undefined);
    return hit.value as T;
  }
  if (hit?.promise) return hit.promise as Promise<T>;
  const gen = keyedGen.n;
  const entry: Keyed = hit ?? { at: 0, has: false };
  keyed.set(key, entry);
  const p = fetch().then(
    (v) => {
      if (gen === keyedGen.n) {
        entry.value = v;
        entry.at = Date.now();
        entry.has = true;
      }
      entry.promise = undefined;
      return v;
    },
    (e) => {
      entry.promise = undefined;
      throw e;
    },
  );
  entry.promise = p;
  return p;
}

/** Drop cached entries (all, or those whose key starts with `prefix`). */
export function clearCached(prefix?: string): void {
  if (!prefix) {
    keyedGen.n++;
    keyed.clear();
    return;
  }
  for (const k of [...keyed.keys()]) if (k.startsWith(prefix)) keyed.delete(k);
}

/** `cached` for data that only changes when we write: fresh for `ttlMs`, then served stale for up to 10 min while it refreshes in the background (writes clear it, so edits still show immediately). */
export const cachedSwr = <T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> =>
  cached(key, ttlMs, fetch, 10 * 60_000);
