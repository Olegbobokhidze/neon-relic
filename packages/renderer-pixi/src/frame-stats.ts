export type FrameStatsSnapshot = {
  readonly fps: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Frames slower than 1.5× a 60Hz budget in the window. */
  readonly jank: number;
  /** Most recent frame times (oldest first), for sparklines. */
  readonly samples: readonly number[];
};

/** Fixed-size ring buffer of frame times. Allocation-free on `push`. */
export class FrameStats {
  private readonly buf: Float32Array;
  private index = 0;
  private count = 0;

  constructor(readonly capacity = 240) {
    this.buf = new Float32Array(capacity);
  }

  push(frameMs: number): void {
    this.buf[this.index] = frameMs;
    this.index = (this.index + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  reset(): void {
    this.index = 0;
    this.count = 0;
  }

  snapshot(): FrameStatsSnapshot {
    const n = this.count;
    if (n === 0) return { fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0, jank: 0, samples: [] };
    const samples: number[] = new Array<number>(n);
    const start = (this.index - n + this.capacity) % this.capacity;
    let sum = 0;
    let max = 0;
    let jank = 0;
    for (let i = 0; i < n; i++) {
      const v = this.buf[(start + i) % this.capacity] ?? 0;
      samples[i] = v;
      sum += v;
      if (v > max) max = v;
      if (v > 25) jank++;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0;
    const avg = sum / n;
    return { fps: avg > 0 ? 1000 / avg : 0, avgMs: avg, p95Ms: p95, maxMs: max, jank, samples };
  }
}
