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
