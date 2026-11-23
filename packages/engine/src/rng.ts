/**
 * Seeded, serialisable PRNG (mulberry32). Never use Math.random() inside the engine;
 * inject an `Rng` so every outcome can be replayed from a seed.
 */
export type Rng = {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Current internal state. Pass it to `createRng` to resume the sequence. */
  state(): number;
};

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    state: () => s,
  };
}

export function pickWeighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += weightOf(item);
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  const last = items[items.length - 1];
  if (last === undefined) throw new Error('pickWeighted: empty item list');
  return last;
}
