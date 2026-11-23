/**
 * SlotController: runs the pure state machine, interprets its effects against the ports,
 * and exposes a `subscribe` / `getSnapshot` pair compatible with React's useSyncExternalStore.
 * Framework-free (ADR-0001).
 */
import { assertValidConfig, type GameConfig } from './config';
import { evaluateGrid } from './evaluate';
import { createImmediateReels, ProviderErrorCode, type Clock, type OutcomeProvider, type ReelsPort, type SpinResponse, type TimerHandle } from './ports';
import {
  createInitialContext,
  EffectType,
  SlotEventType,
  SpinState,
  TimerKey,
  transition,
  type Effect,
  type SlotContext,
  type SlotEvent,
  type SpinState as SpinStateT,
} from './state-machine';

export type TransitionRecord = {
  readonly seq: number;
  /** Clock time (ms) when the event was processed. */
  readonly at: number;
  /** Wall-clock ISO timestamp for logs and exports. */
  readonly iso: string;
  readonly spinId: number;
  readonly event: SlotEvent['type'];
  readonly from: SpinStateT;
  readonly to: SpinStateT;
  readonly accepted: boolean;
  /** Rejection reason, or an informational note for accepted events. */
  readonly detail: string | null;
};

export type ControllerEvent =
  | { readonly type: 'transition'; readonly record: TransitionRecord }
  | { readonly type: 'response'; readonly response: SpinResponse; readonly latencyMs: number }
  | { readonly type: 'bonus'; readonly awarded: number; readonly retrigger: boolean; readonly durationMs: number }
  | { readonly type: 'featureComplete'; readonly totalWin: number; readonly spins: number }
  | { readonly type: 'configChanged'; readonly config: GameConfig };

export type ControllerSnapshot = {
  readonly ctx: SlotContext;
  readonly config: GameConfig;
};

export type ControllerOptions = {
  readonly config: GameConfig;
  readonly provider: OutcomeProvider;
  readonly clock: Clock;
  readonly reels?: ReelsPort;
  readonly balance?: number;
  /** Client-side guard: no response within this window resolves to a TIMEOUT error. */
  readonly requestTimeoutMs?: number;
  readonly historyLimit?: number;
  /** ISO wall-clock provider for transition records (injectable for deterministic tests). */
  readonly isoNow?: () => string;
};

export class SlotController {
  private config: GameConfig;
  private provider: OutcomeProvider;
  private reels: ReelsPort;
  private readonly clock: Clock;
  private readonly requestTimeoutMs: number;
  private readonly historyLimit: number;
  private readonly isoNow: () => string;

  private ctx: SlotContext;
  private snapshot: ControllerSnapshot;
  private readonly queue: SlotEvent[] = [];
  private processing = false;
  private seq = 0;
  private history: TransitionRecord[] = [];
  private readonly timers = new Map<string, TimerHandle>();
  private spinStartedAt = 0;
  private requestSentAt = 0;
  private disposed = false;

  private readonly snapshotListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: ControllerEvent) => void>();

  constructor(options: ControllerOptions) {
    this.config = assertValidConfig(options.config);
    this.provider = options.provider;
    this.clock = options.clock;
    this.reels = options.reels ?? createImmediateReels();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
    this.historyLimit = options.historyLimit ?? 200;
    this.isoNow = options.isoNow ?? (() => new Date().toISOString());
    this.ctx = createInitialContext(this.config, options.balance);
    this.snapshot = { ctx: this.ctx, config: this.config };
  }

  // ------------------------------------------------------------ store API

  readonly subscribe = (listener: () => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };

  readonly getSnapshot = (): ControllerSnapshot => this.snapshot;

  on(listener: (e: ControllerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getHistory(): readonly TransitionRecord[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  // ------------------------------------------------------------ intents

  /** Primary button: spin when idle, otherwise slam-stop / skip. */
  spinOrStop(): void {
    const s = this.ctx.state;
    if (s === SpinState.IDLE) this.dispatch({ type: SlotEventType.SPIN_PRESSED });
    else if (this.ctx.autoSpin && s !== SpinState.WIN_PRESENTATION) this.dispatch({ type: SlotEventType.STOP_AUTO });
    else this.dispatch({ type: SlotEventType.SLAM_STOP });
  }

  spin(): void {
    this.dispatch({ type: SlotEventType.SPIN_PRESSED });
  }
  slamStop(): void {
    this.dispatch({ type: SlotEventType.SLAM_STOP });
  }
  setBetIndex(index: number): void {
    this.dispatch({ type: SlotEventType.SET_BET, index });
  }
  setTurbo(enabled: boolean): void {
    this.dispatch({ type: SlotEventType.SET_TURBO, enabled });
  }
  startAuto(count: number | 'infinite', stopOnWin: boolean): void {
    this.dispatch({ type: SlotEventType.START_AUTO, count, stopOnWin });
  }
  stopAuto(): void {
    this.dispatch({ type: SlotEventType.STOP_AUTO });
  }
  recover(): void {
    this.dispatch({ type: SlotEventType.RECOVER });
  }

  /** Swap the title. Only allowed while IDLE; returns whether it was applied. */
  loadConfig(config: GameConfig): boolean {
    if (this.ctx.state !== SpinState.IDLE) return false;
    this.config = assertValidConfig(config);
    this.cancelAllTimers();
    const fresh = createInitialContext(this.config, this.ctx.balance);
    this.ctx = { ...fresh, spinId: this.ctx.spinId, turbo: this.ctx.turbo, roundsPlayed: this.ctx.roundsPlayed };
    this.publish();
    this.emit({ type: 'configChanged', config: this.config });
    return true;
  }

  /** Swap the backend. Only allowed while IDLE. */
  setProvider(provider: OutcomeProvider): boolean {
    if (this.ctx.state !== SpinState.IDLE) return false;
    this.provider = provider;
    return true;
  }

  attachReels(reels: ReelsPort | null): void {
    this.reels = reels ?? createImmediateReels();
  }

  getConfig(): GameConfig {
    return this.config;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAllTimers();
    this.snapshotListeners.clear();
    this.eventListeners.clear();
  }

  // ------------------------------------------------------------ core loop

  dispatch(event: SlotEvent): void {
    if (this.disposed) return;
    this.queue.push(event);
    if (this.processing) return; // re-entrant dispatch from an effect: handled by the loop below
    this.processing = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) this.process(next);
    } finally {
      this.processing = false;
    }
  }

  private process(event: SlotEvent): void {
    const from = this.ctx.state;
    const result = transition(this.config, this.ctx, event);
    const record: TransitionRecord = {
      seq: ++this.seq,
      at: this.clock.now(),
      iso: this.isoNow(),
      spinId: result.ctx.spinId,
      event: event.type,
      from,
      to: result.ctx.state,
      accepted: result.accepted,
      detail: result.accepted ? result.note : result.reason,
    };
    this.history.push(record);
    if (this.history.length > this.historyLimit) this.history = this.history.slice(-this.historyLimit);

    if (result.accepted) {
      this.ctx = result.ctx;
      this.publish();
    }
    this.emit({ type: 'transition', record });
    if (result.accepted) for (const effect of result.effects) this.run(effect);
  }

  private run(effect: Effect): void {
    switch (effect.type) {
      case EffectType.START_REELS:
        this.spinStartedAt = this.clock.now();
        this.safely(() => this.reels.start({ turbo: effect.turbo }));
        return;

      case EffectType.REQUEST_OUTCOME: {
        const { request } = effect;
        this.requestSentAt = this.clock.now();
        this.setTimer(TimerKey.REQUEST_TIMEOUT, this.requestTimeoutMs, () =>
          this.receive({
            ok: false,
            spinId: request.spinId,
            error: { code: ProviderErrorCode.TIMEOUT, message: `No response within ${this.requestTimeoutMs}ms.`, recoverable: true },
          }),
        );
        let pending: Promise<SpinResponse>;
        try {
          pending = this.provider.spin(request);
        } catch (err) {
          pending = Promise.reject(err);
        }
        pending.then(
          (response) => this.receive(response),
          (err: unknown) =>
            this.receive({
              ok: false,
              spinId: request.spinId,
              error: { code: ProviderErrorCode.NETWORK, message: err instanceof Error ? err.message : String(err), recoverable: true },
            }),
        );
        return;
      }

      case EffectType.WAIT_MIN_SPIN: {
        const elapsed = this.clock.now() - this.spinStartedAt;
        const { spinId } = effect;
        this.setTimer(TimerKey.MIN_SPIN, Math.max(0, effect.minTotalMs - elapsed), () =>
          this.dispatch({ type: SlotEventType.MIN_SPIN_ELAPSED, spinId }),
        );
        return;
      }

      case EffectType.STOP_REELS: {
        const { spinId } = effect;
        this.settle(
          () => this.reels.stop(effect.grid, { teaseReels: effect.teaseReels, quick: effect.quick }),
          () => this.dispatch({ type: SlotEventType.REELS_STOPPED, spinId }),
        );
        return;
      }

      case EffectType.SKIP_REELS:
        this.safely(() => this.reels.skip());
        return;

      case EffectType.ABORT_REELS:
        this.safely(() => this.reels.abort());
        return;

      case EffectType.EVALUATE: {
        const response = this.ctx.round?.response;
        let mismatch: string | null = 'No outcome to evaluate.';
        if (response) {
          // Server is authoritative; the client cross-checks to catch integration bugs (ADR-0004).
          const { outcome } = response;
          const local = evaluateGrid(this.config, outcome.grid, this.ctx.bet, outcome.multiplier);
          mismatch =
            local.totalWin !== outcome.totalWin
              ? `Server totalWin ${outcome.totalWin} ≠ client evaluation ${local.totalWin}.`
              : local.freeSpinsAwarded !== outcome.freeSpinsAwarded
                ? `Server freeSpinsAwarded ${outcome.freeSpinsAwarded} ≠ client ${local.freeSpinsAwarded}.`
                : null;
        }
        this.dispatch({ type: SlotEventType.EVALUATION_DONE, spinId: effect.spinId, mismatch });
        return;
      }

      case EffectType.PRESENT_WINS: {
        const { spinId } = effect;
        this.settle(
          () =>
            this.reels.presentWins({ wins: effect.wins, totalWin: effect.totalWin, bet: effect.bet, tier: effect.tier, turbo: effect.turbo }),
          () => this.dispatch({ type: SlotEventType.PRESENTATION_DONE, spinId }),
        );
        return;
      }

      case EffectType.SKIP_PRESENTATION:
        this.safely(() => this.reels.skipPresentation());
        return;

      case EffectType.SCHEDULE_BONUS_CONTINUE:
        if (effect.announce) this.emit({ type: 'bonus', ...effect.announce, durationMs: effect.ms });
        this.setTimer(TimerKey.BONUS, effect.ms, () => this.dispatch({ type: SlotEventType.BONUS_CONTINUE }));
        return;

      case EffectType.FEATURE_COMPLETE:
        this.emit({ type: 'featureComplete', totalWin: effect.totalWin, spins: effect.spins });
        return;

      case EffectType.SCHEDULE_AUTO_SPIN:
        this.setTimer(TimerKey.AUTO_SPIN, effect.ms, () => this.dispatch({ type: SlotEventType.AUTO_SPIN_TICK }));
        return;

      case EffectType.CANCEL_TIMERS:
        for (const key of effect.timers) this.clearTimer(key);
        return;

      case EffectType.SYNC_BALANCE:
        this.provider.getBalance().then(
          (balance) => {
            const s = this.ctx.state;
            if (s === SpinState.IDLE || s === SpinState.ERROR_RECOVERABLE) this.dispatch({ type: SlotEventType.BALANCE_SYNCED, balance });
          },
          () => undefined,
        );
        return;
    }
  }

  private receive(response: SpinResponse): void {
    if (response.spinId === this.ctx.spinId) this.clearTimer(TimerKey.REQUEST_TIMEOUT);
    this.emit({ type: 'response', response, latencyMs: this.clock.now() - this.requestSentAt });
    this.dispatch({ type: SlotEventType.OUTCOME_RECEIVED, response });
  }

  // ------------------------------------------------------------ utilities

  /** Run a port call that returns a promise; continue even if the renderer throws. */
  private settle(call: () => Promise<void>, then: () => void): void {
    let p: Promise<void>;
    try {
      p = call();
    } catch {
      p = Promise.resolve();
    }
    p.then(then, then);
  }

  private safely(call: () => void): void {
    try {
      call();
    } catch {
      /* a broken renderer must never wedge the state machine */
    }
  }

  private setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    this.timers.set(
      key,
      this.clock.setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, ms),
    );
  }

  private clearTimer(key: string): void {
    const h = this.timers.get(key);
    if (h) this.clock.clearTimeout(h);
    this.timers.delete(key);
  }

  private cancelAllTimers(): void {
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
  }

  private publish(): void {
    this.snapshot = { ctx: this.ctx, config: this.config };
    for (const l of this.snapshotListeners) l();
  }

  private emit(e: ControllerEvent): void {
    for (const l of this.eventListeners) {
      try {
        l(e);
      } catch {
        /* listeners must not break the loop */
      }
    }
  }
}
