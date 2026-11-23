/**
 * Ports: the only ways the engine touches the outside world (ADR-0001, ADR-0004).
 * Concrete implementations live in @slot/adapters, @slot/renderer-pixi and apps/web.
 */
import type { Win, WinTier } from './evaluate';
import type { Grid } from './grid';
import type { SpinMode, SpinOutcome } from './outcome';

// ---------------------------------------------------------------- backend

export type SpinRequest = {
  readonly spinId: number;
  readonly configId: string;
  readonly bet: number;
  readonly mode: SpinMode;
};

export const ProviderErrorCode = {
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  VALIDATION: 'VALIDATION',
  SERVER: 'SERVER',
} as const;
export type ProviderErrorCode = (typeof ProviderErrorCode)[keyof typeof ProviderErrorCode];

export type ProviderError = {
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
};

export type SpinResponse =
  | {
      readonly ok: true;
      readonly spinId: number;
      readonly outcome: SpinOutcome;
      /** Authoritative wallet balance after this spin is settled (includes the win). */
      readonly balanceAfter: number;
    }
  | { readonly ok: false; readonly spinId: number; readonly error: ProviderError };

export type OutcomeProvider = {
  readonly id: string;
  /** Must never reject. Transport failures resolve to `{ ok: false }`. */
  spin(request: SpinRequest): Promise<SpinResponse>;
  getBalance(): Promise<number>;
};

// ---------------------------------------------------------------- renderer

export type ReelStopOptions = {
  /** Reels (by index) that spin longer with anticipation FX. */
  readonly teaseReels: readonly number[];
  /** Turbo or slam-stop: compress the stagger and deceleration. */
  readonly quick: boolean;
};

export type WinPresentation = {
  readonly wins: readonly Win[];
  readonly totalWin: number;
  readonly bet: number;
  readonly tier: WinTier;
  readonly turbo: boolean;
};

export type ReelsPort = {
  start(options: { readonly turbo: boolean }): void;
  /** Resolves once every reel has visually settled on `grid`. */
  stop(grid: Grid, options: ReelStopOptions): Promise<void>;
  /** Slam-stop: settle all reels now. The pending `stop` promise still resolves. */
  skip(): void;
  /** Error path: stop spinning wherever the reels are, without a result. */
  abort(): void;
  /** Resolves when the main presentation (including big-win count-up) is done. */
  presentWins(presentation: WinPresentation): Promise<void>;
  skipPresentation(): void;
};

/** Headless reels: resolve immediately. Used before the renderer attaches, and in tests. */
export function createImmediateReels(): ReelsPort {
  return {
    start: () => undefined,
    stop: () => Promise.resolve(),
    skip: () => undefined,
    abort: () => undefined,
    presentWins: () => Promise.resolve(),
    skipPresentation: () => undefined,
  };
}

// ---------------------------------------------------------------- time

export type TimerHandle = { readonly id: number };

export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};
