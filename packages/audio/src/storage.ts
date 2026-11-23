export type KeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

/** localStorage that never throws (private mode, blocked storage, SSR). */
export function createSafeStorage(): KeyValueStore {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get: (key) => {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        ls()?.setItem(key, value);
      } catch {
        /* ignore quota / security errors */
      }
    },
  };
}

export function createMemoryStorage(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}
