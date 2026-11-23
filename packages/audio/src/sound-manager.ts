import { createSafeStorage, type KeyValueStore } from './storage';

export const Sfx = {
  CLICK: 'click',
  SPIN_START: 'spinStart',
  REEL_STOP: 'reelStop',
  SCATTER_LAND: 'scatterLand',
  TEASE: 'tease',
  WIN_SMALL: 'winSmall',
  WIN_BIG: 'winBig',
  BONUS: 'bonus',
  FEATURE_END: 'featureEnd',
  ERROR: 'error',
} as const;
export type Sfx = (typeof Sfx)[keyof typeof Sfx];

export type SoundState = {
  readonly volume: number;
  readonly muted: boolean;
  /** `locked` = awaiting a user gesture; `unavailable` = no Web Audio or it was refused. */
  readonly status: 'locked' | 'running' | 'unavailable';
};

const STORAGE_KEY = 'slot.audio.v1';

type Ctor = new () => AudioContext;

/**
 * All SFX are synthesized with oscillators and noise, so there are no audio files that could fail
 * to load. Every public method is a safe no-op if Web Audio is missing or blocked.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loop: { stop: () => void } | null = null;
  private state: SoundState;
  private readonly listeners = new Set<() => void>();
  private readonly storage: KeyValueStore;
  private readonly ctor: Ctor | null;

  constructor(options: { readonly storage?: KeyValueStore; readonly audioContext?: Ctor | null } = {}) {
    this.storage = options.storage ?? createSafeStorage();
    this.ctor = options.audioContext !== undefined ? options.audioContext : SoundManager.detect();
    let volume = 0.7;
    let muted = false;
    try {
      const raw = this.storage.get(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const p = parsed as { volume?: unknown; muted?: unknown };
          if (typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1) volume = p.volume;
          if (typeof p.muted === 'boolean') muted = p.muted;
        }
      }
    } catch {
      /* corrupt prefs: use defaults */
    }
    this.state = { volume, muted, status: this.ctor ? 'locked' : 'unavailable' };
  }

  private static detect(): Ctor | null {
    const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }

  // ------------------------------------------------------------ state

  getState(): SoundState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setVolume(volume: number): void {
    this.update({ volume: Math.max(0, Math.min(1, volume)) });
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
  }

  toggleMuted(): void {
    this.setMuted(!this.state.muted);
  }

  private update(patch: Partial<Pick<SoundState, 'volume' | 'muted'>>): void {
    this.state = { ...this.state, ...patch };
    this.storage.set(STORAGE_KEY, JSON.stringify({ volume: this.state.volume, muted: this.state.muted }));
    this.applyGain();
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ lifecycle

  /** Call from a user gesture (pointerdown / keydown). Idempotent. */
  unlock(): void {
    if (!this.ctor) return;
    try {
      if (!this.ctx) {
        this.ctx = new this.ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
        this.applyGain();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      this.state = { ...this.state, status: 'running' };
      this.emit();
    } catch {
      this.ctx = null;
      this.state = { ...this.state, status: 'unavailable' };
      this.emit();
    }
  }

  /** Pause audio when the tab is hidden; resume when visible. */
  setPageVisible(visible: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (visible) void ctx.resume().catch(() => undefined);
      else void ctx.suspend().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.stopLoop();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.listeners.clear();
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.state.muted ? 0 : this.state.volume * 0.6;
    try {
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ playback

  play(sfx: Sfx, options: { readonly pitch?: number } = {}): void {
    const ctx = this.ready();
    if (!ctx) return;
    try {
      const t = ctx.currentTime + 0.005;
      const k = options.pitch ?? 1;
      switch (sfx) {
        case Sfx.CLICK:
          this.tone(ctx, t, 1800 * k, 0.03, 'square', 0.08);
          break;
        case Sfx.SPIN_START:
          this.tone(ctx, t, 220 * k, 0.18, 'sawtooth', 0.12, 660 * k);
          this.burst(ctx, t, 0.12, 2400, 0.1);
          break;
        case Sfx.REEL_STOP:
          this.tone(ctx, t, 140 * k, 0.09, 'sine', 0.5, 55);
          this.burst(ctx, t, 0.04, 3200, 0.12);
          break;
        case Sfx.SCATTER_LAND:
          for (const [f, d] of [
            [880, 0],
            [1320, 0.06],
            [1760, 0.12],
          ] as const) this.tone(ctx, t + d, f * k, 0.5, 'sine', 0.18);
          break;
        case Sfx.TEASE:
          this.tone(ctx, t, 180, 1.2, 'sawtooth', 0.07, 720);
          this.tone(ctx, t, 182, 1.2, 'sawtooth', 0.07, 726);
          break;
        case Sfx.WIN_SMALL:
          [523, 659, 784].forEach((f, i) => this.tone(ctx, t + i * 0.07, f * k, 0.22, 'triangle', 0.2));
          break;
        case Sfx.WIN_BIG:
          [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(ctx, t + i * 0.09, f, 0.45, 'triangle', 0.22));
          [262, 330, 392].forEach((f) => this.tone(ctx, t + 0.55, f, 1.4, 'sawtooth', 0.06));
          break;
        case Sfx.BONUS:
          [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, t + i * 0.11, f, 0.5, 'square', 0.08));
          this.tone(ctx, t + 0.6, 1047, 1.2, 'triangle', 0.18);
          break;
        case Sfx.FEATURE_END:
          [784, 659, 523, 784].forEach((f, i) => this.tone(ctx, t + i * 0.12, f, 0.35, 'triangle', 0.18));
          break;
        case Sfx.ERROR:
          this.tone(ctx, t, 330, 0.16, 'square', 0.1);
          this.tone(ctx, t + 0.18, 220, 0.26, 'square', 0.1);
          break;
      }
    } catch {
      /* never let audio break the game */
    }
  }

  /** Low rumble + filtered noise while reels spin. */
  startLoop(): void {
    const ctx = this.ready();
    if (!ctx || this.loop || !this.master || !this.noise) return;
    try {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.15);
      gain.connect(this.master);

      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      src.connect(bp).connect(gain);

      const hum = ctx.createOscillator();
      hum.type = 'triangle';
      hum.frequency.value = 72;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.6;
      hum.connect(humGain).connect(gain);

      // Rhythmic "ticks" via an LFO on the filter.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 14;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 500;
      lfo.connect(lfoGain).connect(bp.frequency);

      src.start();
      hum.start();
      lfo.start();
      this.loop = {
        stop: () => {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.12);
          for (const n of [src, hum, lfo]) n.stop(now + 0.15);
        },
      };
    } catch {
      this.loop = null;
    }
  }

  stopLoop(): void {
    try {
      this.loop?.stop();
    } catch {
      /* ignore */
    }
    this.loop = null;
  }

  private ready(): AudioContext | null {
    if (!this.ctx || this.state.muted) return null;
    return this.ctx.state === 'closed' ? null : this.ctx;
  }

  private tone(ctx: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private burst(ctx: AudioContext, at: number, dur: number, freq: number, vol: number): void {
    if (!this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
