/**
 * Pure, table-driven spin state machine (ADR-0003).
 *
 *   IDLE → SPIN_REQUESTED → SPINNING → STOPPING → EVALUATING → [WIN_PRESENTATION] → [BONUS_OR_FREE_SPINS] → IDLE
 *                      ↘ ERROR_RECOVERABLE ↗ (RECOVER)
 *
 * `transition()` never performs side effects. It returns effect descriptors that the controller
 * interprets, so a given (config, context, event) always produces the same result.
 */
import type { GameConfig } from './config';
import { computeTeaseReels as computeTease, winTier, type Win, type WinTier } from './evaluate';
import type { Grid } from './grid';
import { SpinMode } from './outcome';
import { ProviderErrorCode, type ProviderError, type SpinRequest, type SpinResponse } from './ports';

// ------------------------------------------------------------------ states

export const SpinState = {
  IDLE: 'IDLE',
  SPIN_REQUESTED: 'SPIN_REQUESTED',
  SPINNING: 'SPINNING',
  STOPPING: 'STOPPING',
  EVALUATING: 'EVALUATING',
  WIN_PRESENTATION: 'WIN_PRESENTATION',
  BONUS_OR_FREE_SPINS: 'BONUS_OR_FREE_SPINS',
  ERROR_RECOVERABLE: 'ERROR_RECOVERABLE',
} as const;
export type SpinState = (typeof SpinState)[keyof typeof SpinState];

/** Canonical display order (inspector). */
export const SPIN_STATE_ORDER: readonly SpinState[] = [
  SpinState.IDLE,
  SpinState.SPIN_REQUESTED,
  SpinState.SPINNING,
  SpinState.STOPPING,
  SpinState.EVALUATING,
  SpinState.WIN_PRESENTATION,
  SpinState.BONUS_OR_FREE_SPINS,
  SpinState.ERROR_RECOVERABLE,
];

// ------------------------------------------------------------------ events

export const SlotEventType = {
  SPIN_PRESSED: 'SPIN_PRESSED',
  AUTO_SPIN_TICK: 'AUTO_SPIN_TICK',
  OUTCOME_RECEIVED: 'OUTCOME_RECEIVED',
  MIN_SPIN_ELAPSED: 'MIN_SPIN_ELAPSED',
  SLAM_STOP: 'SLAM_STOP',
  REELS_STOPPED: 'REELS_STOPPED',
  EVALUATION_DONE: 'EVALUATION_DONE',
  PRESENTATION_DONE: 'PRESENTATION_DONE',
  BONUS_CONTINUE: 'BONUS_CONTINUE',
  RECOVER: 'RECOVER',
  SET_BET: 'SET_BET',
  SET_TURBO: 'SET_TURBO',
  START_AUTO: 'START_AUTO',
  STOP_AUTO: 'STOP_AUTO',
  BALANCE_SYNCED: 'BALANCE_SYNCED',
} as const;
export type SlotEventType = (typeof SlotEventType)[keyof typeof SlotEventType];

export type SlotEvent =
  | { readonly type: typeof SlotEventType.SPIN_PRESSED }
  | { readonly type: typeof SlotEventType.AUTO_SPIN_TICK }
  | { readonly type: typeof SlotEventType.OUTCOME_RECEIVED; readonly response: SpinResponse }
  | { readonly type: typeof SlotEventType.MIN_SPIN_ELAPSED; readonly spinId: number }
  | { readonly type: typeof SlotEventType.SLAM_STOP }
  | { readonly type: typeof SlotEventType.REELS_STOPPED; readonly spinId: number }
  | { readonly type: typeof SlotEventType.EVALUATION_DONE; readonly spinId: number; readonly mismatch: string | null }
  | { readonly type: typeof SlotEventType.PRESENTATION_DONE; readonly spinId: number }
  | { readonly type: typeof SlotEventType.BONUS_CONTINUE }
  | { readonly type: typeof SlotEventType.RECOVER }
  | { readonly type: typeof SlotEventType.SET_BET; readonly index: number }
  | { readonly type: typeof SlotEventType.SET_TURBO; readonly enabled: boolean }
  | { readonly type: typeof SlotEventType.START_AUTO; readonly count: number | 'infinite'; readonly stopOnWin: boolean }
  | { readonly type: typeof SlotEventType.STOP_AUTO }
  | { readonly type: typeof SlotEventType.BALANCE_SYNCED; readonly balance: number };

const E = SlotEventType;
const ANYTIME = [E.SET_TURBO, E.STOP_AUTO] as const;

/** Whitelist of events each state accepts. Anything else is rejected and recorded. */
export const ALLOWED_EVENTS: Readonly<Record<SpinState, readonly SlotEventType[]>> = {
  IDLE: [E.SPIN_PRESSED, E.AUTO_SPIN_TICK, E.SET_BET, E.START_AUTO, E.BALANCE_SYNCED, ...ANYTIME],
  SPIN_REQUESTED: [E.OUTCOME_RECEIVED, E.SLAM_STOP, ...ANYTIME],
  SPINNING: [E.MIN_SPIN_ELAPSED, E.SLAM_STOP, ...ANYTIME],
  STOPPING: [E.REELS_STOPPED, E.SLAM_STOP, ...ANYTIME],
  EVALUATING: [E.EVALUATION_DONE, ...ANYTIME],
  WIN_PRESENTATION: [E.PRESENTATION_DONE, E.SLAM_STOP, ...ANYTIME],
  BONUS_OR_FREE_SPINS: [E.BONUS_CONTINUE, ...ANYTIME],
  ERROR_RECOVERABLE: [E.RECOVER, E.BALANCE_SYNCED, ...ANYTIME],
};

// ------------------------------------------------------------------ context

export type AutoSpin = {
  readonly remaining: number;
  readonly infinite: boolean;
  readonly stopOnWin: boolean;
};

export type FreeSpins = {
  readonly remaining: number;
  readonly total: number;
  readonly played: number;
  readonly totalWin: number;
  readonly multiplier: number;
};

export type ActiveRound = {
  readonly request: SpinRequest;
  readonly response: Extract<SpinResponse, { ok: true }> | null;
  readonly slam: boolean;
};

export type SlotContext = {
  readonly state: SpinState;
  readonly configId: string;
  readonly balance: number;
  readonly betIndex: number;
  readonly bet: number;
  readonly turbo: boolean;
  readonly autoSpin: AutoSpin | null;
  readonly freeSpins: FreeSpins | null;
  /** Monotonic round id; responses for any other id are stale and discarded. */
  readonly spinId: number;
  readonly round: ActiveRound | null;
  readonly lastWin: number;
  readonly lastTier: WinTier;
  readonly error: ProviderError | null;
  readonly roundsPlayed: number;
};

export function createInitialContext(config: GameConfig, balance = config.startingBalance): SlotContext {
  const betIndex = config.bet.defaultIndex;
  return {
    state: SpinState.IDLE,
    configId: config.id,
    balance,
    betIndex,
    bet: config.bet.presets[betIndex] ?? 0,
    turbo: false,
    autoSpin: null,
    freeSpins: null,
    spinId: 0,
    round: null,
    lastWin: 0,
    lastTier: 'none',
    error: null,
    roundsPlayed: 0,
  };
}

// ------------------------------------------------------------------ effects

export const EffectType = {
  START_REELS: 'START_REELS',
  REQUEST_OUTCOME: 'REQUEST_OUTCOME',
  WAIT_MIN_SPIN: 'WAIT_MIN_SPIN',
  STOP_REELS: 'STOP_REELS',
  SKIP_REELS: 'SKIP_REELS',
  ABORT_REELS: 'ABORT_REELS',
  EVALUATE: 'EVALUATE',
  PRESENT_WINS: 'PRESENT_WINS',
  SKIP_PRESENTATION: 'SKIP_PRESENTATION',
  SCHEDULE_BONUS_CONTINUE: 'SCHEDULE_BONUS_CONTINUE',
  FEATURE_COMPLETE: 'FEATURE_COMPLETE',
  SCHEDULE_AUTO_SPIN: 'SCHEDULE_AUTO_SPIN',
  CANCEL_TIMERS: 'CANCEL_TIMERS',
  SYNC_BALANCE: 'SYNC_BALANCE',
} as const;
export type EffectType = (typeof EffectType)[keyof typeof EffectType];

export type Effect =
  | { readonly type: typeof EffectType.START_REELS; readonly turbo: boolean }
  | { readonly type: typeof EffectType.REQUEST_OUTCOME; readonly request: SpinRequest }
  | { readonly type: typeof EffectType.WAIT_MIN_SPIN; readonly spinId: number; readonly minTotalMs: number }
  | {
      readonly type: typeof EffectType.STOP_REELS;
      readonly spinId: number;
      readonly grid: Grid;
      readonly teaseReels: readonly number[];
      readonly quick: boolean;
    }
  | { readonly type: typeof EffectType.SKIP_REELS }
  | { readonly type: typeof EffectType.ABORT_REELS }
  | { readonly type: typeof EffectType.EVALUATE; readonly spinId: number }
  | {
      readonly type: typeof EffectType.PRESENT_WINS;
      readonly spinId: number;
      readonly wins: readonly Win[];
      readonly totalWin: number;
      readonly bet: number;
      readonly tier: WinTier;
      readonly turbo: boolean;
    }
  | { readonly type: typeof EffectType.SKIP_PRESENTATION }
  | {
      readonly type: typeof EffectType.SCHEDULE_BONUS_CONTINUE;
      readonly ms: number;
      readonly announce: { readonly awarded: number; readonly retrigger: boolean } | null;
    }
  | { readonly type: typeof EffectType.FEATURE_COMPLETE; readonly totalWin: number; readonly spins: number }
  | { readonly type: typeof EffectType.SCHEDULE_AUTO_SPIN; readonly ms: number }
  | { readonly type: typeof EffectType.CANCEL_TIMERS; readonly timers: readonly TimerKey[] }
  | { readonly type: typeof EffectType.SYNC_BALANCE };

export const TimerKey = {
  MIN_SPIN: 'minSpin',
  AUTO_SPIN: 'autoSpin',
  BONUS: 'bonus',
  REQUEST_TIMEOUT: 'requestTimeout',
} as const;
export type TimerKey = (typeof TimerKey)[keyof typeof TimerKey];

export type TransitionResult =
  | { readonly accepted: true; readonly ctx: SlotContext; readonly effects: readonly Effect[]; readonly note: string | null }
  | { readonly accepted: false; readonly ctx: SlotContext; readonly reason: string };

export const RejectReason = {
  NOT_ALLOWED_IN_STATE: 'NOT_ALLOWED_IN_STATE',
  STALE_SPIN_ID: 'STALE_SPIN_ID',
  INVALID_BET_INDEX: 'INVALID_BET_INDEX',
  INVALID_AUTO_COUNT: 'INVALID_AUTO_COUNT',
  NO_AUTOPLAY: 'NO_AUTOPLAY',
  NO_ACTIVE_ROUND: 'NO_ACTIVE_ROUND',
} as const;
export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

// ------------------------------------------------------------------ reducer

const reject = (ctx: SlotContext, reason: string): TransitionResult => ({ accepted: false, ctx, reason });
const accept = (ctx: SlotContext, effects: readonly Effect[] = [], note: string | null = null): TransitionResult => ({
  accepted: true,
  ctx,
  effects,
  note,
});

export function isAllowed(state: SpinState, type: SlotEventType): boolean {
  return ALLOWED_EVENTS[state].includes(type);
}

export function transition(config: GameConfig, ctx: SlotContext, event: SlotEvent): TransitionResult {
  if (!isAllowed(ctx.state, event.type)) return reject(ctx, RejectReason.NOT_ALLOWED_IN_STATE);

  switch (event.type) {
    case E.SPIN_PRESSED:
      return startBaseRound(config, ctx, false);

    case E.AUTO_SPIN_TICK:
      if (!ctx.autoSpin) return reject(ctx, RejectReason.NO_AUTOPLAY);
      return startBaseRound(config, ctx, true);

    case E.START_AUTO: {
      if (event.count !== 'infinite' && (!Number.isInteger(event.count) || event.count < 1)) {
        return reject(ctx, RejectReason.INVALID_AUTO_COUNT);
      }
      const autoSpin: AutoSpin =
        event.count === 'infinite'
          ? { remaining: 0, infinite: true, stopOnWin: event.stopOnWin }
          : { remaining: event.count, infinite: false, stopOnWin: event.stopOnWin };
      return startBaseRound(config, { ...ctx, autoSpin }, true);
    }

    case E.STOP_AUTO:
      if (!ctx.autoSpin) return reject(ctx, RejectReason.NO_AUTOPLAY);
      return accept({ ...ctx, autoSpin: null }, [{ type: EffectType.CANCEL_TIMERS, timers: [TimerKey.AUTO_SPIN] }]);

    case E.SET_TURBO:
      return accept({ ...ctx, turbo: event.enabled });

    case E.SET_BET: {
      const bet = config.bet.presets[event.index];
      if (bet === undefined) return reject(ctx, RejectReason.INVALID_BET_INDEX);
      return accept({ ...ctx, betIndex: event.index, bet });
    }

    case E.BALANCE_SYNCED:
      return accept({ ...ctx, balance: event.balance });

    case E.OUTCOME_RECEIVED: {
      const round = ctx.round;
      if (!round) return reject(ctx, RejectReason.NO_ACTIVE_ROUND);
      if (event.response.spinId !== ctx.spinId) return reject(ctx, RejectReason.STALE_SPIN_ID);
      if (!event.response.ok) return toError(ctx, event.response.error, true);
      const next: SlotContext = { ...ctx, state: SpinState.SPINNING, round: { ...round, response: event.response } };
      const minTotalMs = round.slam ? 0 : ctx.turbo ? config.timing.turboMinSpinMs : config.timing.minSpinMs;
      return accept(next, [{ type: EffectType.WAIT_MIN_SPIN, spinId: ctx.spinId, minTotalMs }]);
    }

    case E.MIN_SPIN_ELAPSED:
      if (event.spinId !== ctx.spinId) return reject(ctx, RejectReason.STALE_SPIN_ID);
      return beginStopping(config, ctx, ctx.turbo || (ctx.round?.slam ?? false));

    case E.SLAM_STOP: {
      const round = ctx.round;
      if (!round) return reject(ctx, RejectReason.NO_ACTIVE_ROUND);
      if (ctx.state === SpinState.SPIN_REQUESTED) {
        // Outcome not known yet: remember the intent; stop as soon as it arrives.
        return accept({ ...ctx, round: { ...round, slam: true } }, [], 'slam queued until outcome arrives');
      }
      if (ctx.state === SpinState.SPINNING) {
        const r = beginStopping(config, { ...ctx, round: { ...round, slam: true } }, true);
        return r.accepted ? accept(r.ctx, [{ type: EffectType.CANCEL_TIMERS, timers: [TimerKey.MIN_SPIN] }, ...r.effects]) : r;
      }
      if (ctx.state === SpinState.STOPPING) {
        return accept({ ...ctx, round: { ...round, slam: true } }, [{ type: EffectType.SKIP_REELS }]);
      }
      // WIN_PRESENTATION
      return accept(ctx, [{ type: EffectType.SKIP_PRESENTATION }]);
    }

    case E.REELS_STOPPED:
      if (event.spinId !== ctx.spinId) return reject(ctx, RejectReason.STALE_SPIN_ID);
      return accept({ ...ctx, state: SpinState.EVALUATING }, [{ type: EffectType.EVALUATE, spinId: ctx.spinId }]);

    case E.EVALUATION_DONE: {
      if (event.spinId !== ctx.spinId) return reject(ctx, RejectReason.STALE_SPIN_ID);
      const response = ctx.round?.response;
      if (!response) return reject(ctx, RejectReason.NO_ACTIVE_ROUND);
      if (event.mismatch !== null) {
        // The server already settled; don't refund. Resync the balance on recovery instead.
        return toError(ctx, { code: ProviderErrorCode.VALIDATION, message: event.mismatch, recoverable: true }, false);
      }
      const { outcome } = response;
      if (outcome.totalWin > 0) {
        const tier = winTier(outcome.totalWin, ctx.bet);
        return accept({ ...ctx, state: SpinState.WIN_PRESENTATION, lastWin: outcome.totalWin, lastTier: tier }, [
          {
            type: EffectType.PRESENT_WINS,
            spinId: ctx.spinId,
            wins: outcome.wins,
            totalWin: outcome.totalWin,
            bet: ctx.bet,
            tier,
            turbo: ctx.turbo,
          },
        ]);
      }
      return finishRound(config, ctx);
    }

    case E.PRESENTATION_DONE:
      if (event.spinId !== ctx.spinId) return reject(ctx, RejectReason.STALE_SPIN_ID);
      return finishRound(config, ctx);

    case E.BONUS_CONTINUE: {
      const fs = ctx.freeSpins;
      if (fs && fs.remaining > 0) return startRound(config, ctx, SpinMode.FREE, false);
      return accept({ ...ctx, state: SpinState.IDLE, freeSpins: null });
    }

    case E.RECOVER: {
      const base: SlotContext = { ...ctx, error: null, round: null };
      if (ctx.freeSpins && ctx.freeSpins.remaining > 0) {
        return accept({ ...base, state: SpinState.BONUS_OR_FREE_SPINS }, [
          { type: EffectType.SYNC_BALANCE },
          { type: EffectType.SCHEDULE_BONUS_CONTINUE, ms: config.timing.autoSpinDelayMs, announce: null },
        ]);
      }
      return accept({ ...base, state: SpinState.IDLE }, [{ type: EffectType.SYNC_BALANCE }]);
    }
  }
}

// ------------------------------------------------------------------ helpers

function startBaseRound(config: GameConfig, ctx: SlotContext, fromAuto: boolean): TransitionResult {
  if (ctx.balance < ctx.bet) {
    return toError(
      ctx,
      { code: ProviderErrorCode.INSUFFICIENT_FUNDS, message: 'Your balance is too low for this bet.', recoverable: true },
      false,
    );
  }
  return startRound(config, ctx, SpinMode.BASE, fromAuto);
}

function startRound(config: GameConfig, ctx: SlotContext, mode: SpinMode, fromAuto: boolean): TransitionResult {
  const spinId = ctx.spinId + 1;
  const request: SpinRequest = { spinId, configId: config.id, bet: ctx.bet, mode };
  let autoSpin = ctx.autoSpin;
  if (fromAuto && autoSpin && !autoSpin.infinite) autoSpin = { ...autoSpin, remaining: autoSpin.remaining - 1 };
  const freeSpins =
    mode === SpinMode.FREE && ctx.freeSpins ? { ...ctx.freeSpins, remaining: ctx.freeSpins.remaining - 1 } : ctx.freeSpins;

  const next: SlotContext = {
    ...ctx,
    state: SpinState.SPIN_REQUESTED,
    spinId,
    // Optimistic debit: the displayed balance is always what the player can still spend.
    balance: mode === SpinMode.BASE ? ctx.balance - ctx.bet : ctx.balance,
    autoSpin,
    freeSpins,
    round: { request, response: null, slam: false },
    lastWin: 0,
    lastTier: 'none',
    error: null,
  };
  return accept(next, [
    { type: EffectType.START_REELS, turbo: ctx.turbo },
    { type: EffectType.REQUEST_OUTCOME, request },
  ]);
}

function beginStopping(config: GameConfig, ctx: SlotContext, quick: boolean): TransitionResult {
  const response = ctx.round?.response;
  if (!response) return reject(ctx, RejectReason.NO_ACTIVE_ROUND);
  const teaseReels = quick ? [] : computeTease(config, response.outcome.grid);
  return accept({ ...ctx, state: SpinState.STOPPING }, [
    { type: EffectType.STOP_REELS, spinId: ctx.spinId, grid: response.outcome.grid, teaseReels, quick },
  ]);
}

function toError(ctx: SlotContext, error: ProviderError, refund: boolean): TransitionResult {
  const request = ctx.round?.request;
  let balance = ctx.balance;
  let freeSpins = ctx.freeSpins;
  if (refund && request) {
    if (request.mode === SpinMode.BASE) balance += request.bet;
    else if (freeSpins) freeSpins = { ...freeSpins, remaining: freeSpins.remaining + 1 };
  }
  return accept(
    { ...ctx, state: SpinState.ERROR_RECOVERABLE, error, balance, freeSpins, autoSpin: null },
    [
      { type: EffectType.ABORT_REELS },
      { type: EffectType.CANCEL_TIMERS, timers: [TimerKey.AUTO_SPIN, TimerKey.MIN_SPIN, TimerKey.REQUEST_TIMEOUT] },
    ],
    `${error.code}${refund && request ? ' (stake refunded)' : ''}`,
  );
}

function finishRound(config: GameConfig, ctx: SlotContext): TransitionResult {
  const response = ctx.round?.response;
  if (!response) return reject(ctx, RejectReason.NO_ACTIVE_ROUND);
  const { outcome } = response;
  const settled: SlotContext = { ...ctx, balance: response.balanceAfter, roundsPlayed: ctx.roundsPlayed + 1 };

  let freeSpins = settled.freeSpins;
  if (freeSpins && outcome.mode === SpinMode.FREE) {
    freeSpins = { ...freeSpins, played: freeSpins.played + 1, totalWin: freeSpins.totalWin + outcome.totalWin };
  }

  // Feature triggered (or retriggered).
  if (outcome.freeSpinsAwarded > 0) {
    const retrigger = freeSpins !== null;
    freeSpins = freeSpins
      ? { ...freeSpins, remaining: freeSpins.remaining + outcome.freeSpinsAwarded, total: freeSpins.total + outcome.freeSpinsAwarded }
      : { remaining: outcome.freeSpinsAwarded, total: outcome.freeSpinsAwarded, played: 0, totalWin: 0, multiplier: config.freeSpins.multiplier };
    return accept({ ...settled, freeSpins, state: SpinState.BONUS_OR_FREE_SPINS }, [
      {
        type: EffectType.SCHEDULE_BONUS_CONTINUE,
        ms: config.timing.bonusIntroMs,
        announce: { awarded: outcome.freeSpinsAwarded, retrigger },
      },
    ]);
  }

  // Mid-feature: continue with the next free spin.
  if (freeSpins && freeSpins.remaining > 0) {
    return accept({ ...settled, freeSpins, state: SpinState.BONUS_OR_FREE_SPINS }, [
      { type: EffectType.SCHEDULE_BONUS_CONTINUE, ms: config.timing.autoSpinDelayMs, announce: null },
    ]);
  }

  const effects: Effect[] = [];
  if (freeSpins) effects.push({ type: EffectType.FEATURE_COMPLETE, totalWin: freeSpins.totalWin, spins: freeSpins.played });

  // Autoplay bookkeeping.
  let autoSpin = settled.autoSpin;
  if (autoSpin) {
    const stopForWin = autoSpin.stopOnWin && outcome.totalWin > 0;
    const exhausted = !autoSpin.infinite && autoSpin.remaining <= 0;
    if (stopForWin || exhausted) autoSpin = null;
    else effects.push({ type: EffectType.SCHEDULE_AUTO_SPIN, ms: config.timing.autoSpinDelayMs });
  }

  return accept({ ...settled, freeSpins: null, autoSpin, state: SpinState.IDLE, round: null }, effects);
}
