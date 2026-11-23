import type { Clock, TimerHandle } from './ports';

/** The engine targets plain ES2022 (no DOM lib), so describe the host timer API explicitly. */
type TimerHost = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  performance?: { now(): number };
};
const host = globalThis as unknown as TimerHost;

/** Real clock. This is the only place in the engine that reads ambient time. */
export function createSystemClock(): Clock {
  const handles = new Map<number, unknown>();
  let nextId = 1;
  const perf = host.performance;
  return {
    now: () => (perf ? perf.now() : Date.now()),
    setTimeout: (fn, ms) => {
      const id = nextId++;
      handles.set(
        id,
        host.setTimeout(() => {
          handles.delete(id);
          fn();
        }, ms),
      );
      return { id };
    },
    clearTimeout: (handle) => {
      const h = handles.get(handle.id);
      if (h !== undefined) host.clearTimeout(h);
      handles.delete(handle.id);
    },
  };
}

export type ManualClock = Clock & {
  /** Advance virtual time, firing due timers in order. */
  advance(ms: number): void;
  pendingTimers(): number;
};

/** Deterministic virtual clock for tests and replays. */
export function createManualClock(start = 0): ManualClock {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms): TimerHandle => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return { id };
    },
    clearTimeout: (handle) => {
      timers.delete(handle.id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const timer = timers.get(dueId);
        timers.delete(dueId);
        now = dueAt;
        timer?.fn();
      }
      now = target;
    },
    pendingTimers: () => timers.size,
  };
}
