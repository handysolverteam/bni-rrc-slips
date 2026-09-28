/**
 * Minimal in-memory TTL cache for server-side data that changes rarely
 * (week calendar, chat snapshot). Per-process memory: on multi-instance
 * hosting each instance simply holds its own copy. Callers clear on import.
 */
export function createTtlCache<T>(ttlMs: number) {
  let at = 0;
  let value: T | null = null;
  let has = false;

  return {
    async get(fetch: () => Promise<T>): Promise<T> {
      if (has && Date.now() - at < ttlMs) return value as T;
      value = await fetch();
      at = Date.now();
      has = true;
      return value;
    },
    clear() {
      has = false;
      value = null;
      at = 0;
    },
  };
}
