import { describe, expect, it } from 'vitest';
import { linesConfig, makeGrid } from './__fixtures__/configs';
import { buildOutcome } from './outcome';
import type { SpinResponse } from './ports';
import {
  ALLOWED_EVENTS,
  createInitialContext,
  EffectType,
  SlotEventType as E,
  SPIN_STATE_ORDER,
  SpinState,
  transition,
  type SlotContext,
  type SlotEvent,
} from './state-machine';

const cfg = linesConfig;
const BET = 100;

function run(ctx: SlotContext, ...events: SlotEvent[]) {
  let c = ctx;
  const effects: string[] = [];
  for (const e of events) {
    const r = transition(cfg, c, e);
    if (!r.accepted) throw new Error(`rejected ${e.type} in ${c.state}: ${r.reason}`);
    c = r.ctx;
    effects.push(...r.effects.map((x) => x.type));
  }
  return { ctx: c, effects };
}

function okResponse(spinId: number, grid = makeGrid(5, 3, 'X'), mode: 'base' | 'free' = 'base', balanceAfter = 9_900): SpinResponse {
  return { ok: true, spinId, outcome: buildOutcome(cfg, grid, BET, mode), balanceAfter };
}

const winningGrid = makeGrid(5, 3, 'X', [
  [0, 1, 'H'],
  [1, 1, 'H'],
  [2, 1, 'H'],
]);
const scatterGrid = makeGrid(5, 3, 'X', [
  [0, 0, 'S'],
  [2, 0, 'S'],
  [4, 0, 'S'],
]);

describe('transition table', () => {
  it('covers every state', () => {
    for (const s of SPIN_STATE_ORDER) expect(ALLOWED_EVENTS[s]).toBeDefined();
  });

  it('happy path, no win: IDLE → … → IDLE with balance settled from the server', () => {
    const c0 = createInitialContext(cfg);
    const { ctx: c1, effects: e1 } = run(c0, { type: E.SPIN_PRESSED });
    expect(c1.state).toBe(SpinState.SPIN_REQUESTED);
    expect(c1.balance).toBe(10_000 - BET);
    expect(e1).toEqual([EffectType.START_REELS, EffectType.REQUEST_OUTCOME]);

    const { ctx: c2 } = run(
      c1,
      { type: E.OUTCOME_RECEIVED, response: okResponse(1) },
      { type: E.MIN_SPIN_ELAPSED, spinId: 1 },
      { type: E.REELS_STOPPED, spinId: 1 },
    );
    expect(c2.state).toBe(SpinState.EVALUATING);
    const { ctx: c3 } = run(c2, { type: E.EVALUATION_DONE, spinId: 1, mismatch: null });
    expect(c3.state).toBe(SpinState.IDLE);
    expect(c3.balance).toBe(9_900);
    expect(c3.roundsPlayed).toBe(1);
  });

  it('winning round goes through WIN_PRESENTATION', () => {
    const { ctx } = run(
      createInitialContext(cfg),
      { type: E.SPIN_PRESSED },
      { type: E.OUTCOME_RECEIVED, response: okResponse(1, winningGrid, 'base', 10_000) },
      { type: E.MIN_SPIN_ELAPSED, spinId: 1 },
      { type: E.REELS_STOPPED, spinId: 1 },
      { type: E.EVALUATION_DONE, spinId: 1, mismatch: null },
    );
    expect(ctx.state).toBe(SpinState.WIN_PRESENTATION);
    expect(ctx.lastWin).toBe(100);
    const { ctx: done } = run(ctx, { type: E.PRESENTATION_DONE, spinId: 1 });
    expect(done.state).toBe(SpinState.IDLE);
  });

  it('rejects a second SPIN while a round is in flight (no double spin)', () => {
    const { ctx } = run(createInitialContext(cfg), { type: E.SPIN_PRESSED });
    const r = transition(cfg, ctx, { type: E.SPIN_PRESSED });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reason).toBe('NOT_ALLOWED_IN_STATE');
    expect(r.ctx.balance).toBe(10_000 - BET); // debited exactly once
  });

  it('discards stale responses by spinId', () => {
    const { ctx } = run(createInitialContext(cfg), { type: E.SPIN_PRESSED });
    const r = transition(cfg, ctx, { type: E.OUTCOME_RECEIVED, response: okResponse(99) });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reason).toBe('STALE_SPIN_ID');
  });

  it('error refunds the stake, cancels autoplay, and RECOVER returns to IDLE', () => {
    const { ctx } = run(createInitialContext(cfg), { type: E.START_AUTO, count: 10, stopOnWin: false });
    expect(ctx.autoSpin?.remaining).toBe(9);
    const { ctx: err } = run(ctx, {
      type: E.OUTCOME_RECEIVED,
      response: { ok: false, spinId: 1, error: { code: 'NETWORK', message: 'x', recoverable: true } },
    });
    expect(err.state).toBe(SpinState.ERROR_RECOVERABLE);
    expect(err.balance).toBe(10_000);
    expect(err.autoSpin).toBeNull();
    const { ctx: rec, effects } = run(err, { type: E.RECOVER });
    expect(rec.state).toBe(SpinState.IDLE);
    expect(effects).toContain(EffectType.SYNC_BALANCE);
  });

  it('insufficient funds goes straight to ERROR_RECOVERABLE without debiting', () => {
    const poor = { ...createInitialContext(cfg), balance: 50 };
    const { ctx } = run(poor, { type: E.SPIN_PRESSED });
    expect(ctx.state).toBe(SpinState.ERROR_RECOVERABLE);
    expect(ctx.error?.code).toBe('INSUFFICIENT_FUNDS');
    expect(ctx.balance).toBe(50);
  });

  it('slam during SPIN_REQUESTED skips the minimum spin time once the outcome arrives', () => {
    const r = run(createInitialContext(cfg), { type: E.SPIN_PRESSED }, { type: E.SLAM_STOP });
    const t = transition(cfg, r.ctx, { type: E.OUTCOME_RECEIVED, response: okResponse(1) });
    expect(t.accepted && t.effects[0]).toMatchObject({ type: EffectType.WAIT_MIN_SPIN, minTotalMs: 0 });
  });

  it('slam during SPINNING stops immediately with quick=true and no tease', () => {
    const r = run(createInitialContext(cfg), { type: E.SPIN_PRESSED }, { type: E.OUTCOME_RECEIVED, response: okResponse(1) });
    const t = transition(cfg, r.ctx, { type: E.SLAM_STOP });
    expect(t.ctx.state).toBe(SpinState.STOPPING);
    const stop = t.accepted ? t.effects.find((e) => e.type === EffectType.STOP_REELS) : undefined;
    expect(stop).toMatchObject({ quick: true, teaseReels: [] });
  });

  it('turbo shortens the minimum spin time', () => {
    const r = run(
      createInitialContext(cfg),
      { type: E.SET_TURBO, enabled: true },
      { type: E.SPIN_PRESSED },
    );
    const t = transition(cfg, r.ctx, { type: E.OUTCOME_RECEIVED, response: okResponse(1) });
    expect(t.accepted && t.effects[0]).toMatchObject({ minTotalMs: cfg.timing.turboMinSpinMs });
  });

  it('SET_BET only while IDLE and only to valid presets', () => {
    const c = createInitialContext(cfg);
    expect(transition(cfg, c, { type: E.SET_BET, index: 2 }).ctx.bet).toBe(1000);
    expect(transition(cfg, c, { type: E.SET_BET, index: 9 }).accepted).toBe(false);
    const spinning = run(c, { type: E.SPIN_PRESSED }).ctx;
    expect(transition(cfg, spinning, { type: E.SET_BET, index: 0 }).accepted).toBe(false);
  });

  it('validation mismatch is an error without refund', () => {
    const r = run(
      createInitialContext(cfg),
      { type: E.SPIN_PRESSED },
      { type: E.OUTCOME_RECEIVED, response: okResponse(1) },
      { type: E.MIN_SPIN_ELAPSED, spinId: 1 },
      { type: E.REELS_STOPPED, spinId: 1 },
      { type: E.EVALUATION_DONE, spinId: 1, mismatch: 'bad' },
    );
    expect(r.ctx.state).toBe(SpinState.ERROR_RECOVERABLE);
    expect(r.ctx.error?.code).toBe('VALIDATION');
    expect(r.ctx.balance).toBe(10_000 - BET);
  });
});

describe('autoplay', () => {
  const playRound = (ctx: SlotContext, response: SpinResponse) => {
    const id = ctx.spinId;
    let r = run(
      ctx,
      { type: E.OUTCOME_RECEIVED, response },
      { type: E.MIN_SPIN_ELAPSED, spinId: id },
      { type: E.REELS_STOPPED, spinId: id },
      { type: E.EVALUATION_DONE, spinId: id, mismatch: null },
    );
    if (r.ctx.state === SpinState.WIN_PRESENTATION) {
      const more = run(r.ctx, { type: E.PRESENTATION_DONE, spinId: id });
      r = { ctx: more.ctx, effects: [...r.effects, ...more.effects] };
    }
    return r;
  };

  it('counts down and stops when exhausted', () => {
    let { ctx } = run(createInitialContext(cfg), { type: E.START_AUTO, count: 2, stopOnWin: false });
    let r = playRound(ctx, okResponse(1));
    expect(r.effects).toContain(EffectType.SCHEDULE_AUTO_SPIN);
    ctx = run(r.ctx, { type: E.AUTO_SPIN_TICK }).ctx;
    expect(ctx.autoSpin?.remaining).toBe(0);
    r = playRound(ctx, okResponse(2));
    expect(r.effects).not.toContain(EffectType.SCHEDULE_AUTO_SPIN);
    expect(r.ctx.autoSpin).toBeNull();
  });

  it('stop-on-win ends autoplay after a winning round', () => {
    const { ctx } = run(createInitialContext(cfg), { type: E.START_AUTO, count: 'infinite', stopOnWin: true });
    const r = playRound(ctx, okResponse(1, winningGrid, 'base', 10_000));
    expect(r.ctx.autoSpin).toBeNull();
  });

  it('AUTO_SPIN_TICK after STOP_AUTO is rejected', () => {
    const { ctx } = run(createInitialContext(cfg), { type: E.START_AUTO, count: 5, stopOnWin: false });
    const idle = playRound(run(ctx, { type: E.STOP_AUTO }).ctx, okResponse(1)).ctx;
    expect(transition(cfg, idle, { type: E.AUTO_SPIN_TICK }).accepted).toBe(false);
  });
});

describe('free spins', () => {
  it('trigger → BONUS_OR_FREE_SPINS → free rounds (no debit) → feature complete → IDLE', () => {
    let { ctx } = run(
      createInitialContext(cfg),
      { type: E.SPIN_PRESSED },
      { type: E.OUTCOME_RECEIVED, response: okResponse(1, scatterGrid, 'base', 10_100) },
      { type: E.MIN_SPIN_ELAPSED, spinId: 1 },
      { type: E.REELS_STOPPED, spinId: 1 },
      { type: E.EVALUATION_DONE, spinId: 1, mismatch: null },
      { type: E.PRESENTATION_DONE, spinId: 1 },
    );
    expect(ctx.state).toBe(SpinState.BONUS_OR_FREE_SPINS);
    expect(ctx.freeSpins).toMatchObject({ remaining: 5, total: 5, multiplier: 2 });

    const balanceBefore = ctx.balance;
    for (let i = 0; i < 5; i++) {
      ctx = run(ctx, { type: E.BONUS_CONTINUE }).ctx;
      expect(ctx.state).toBe(SpinState.SPIN_REQUESTED);
      expect(ctx.round?.request.mode).toBe('free');
      expect(ctx.balance).toBe(balanceBefore);
      const id = ctx.spinId;
      const r = run(
        ctx,
        { type: E.OUTCOME_RECEIVED, response: okResponse(id, makeGrid(5, 3, 'X'), 'free', balanceBefore) },
        { type: E.MIN_SPIN_ELAPSED, spinId: id },
        { type: E.REELS_STOPPED, spinId: id },
        { type: E.EVALUATION_DONE, spinId: id, mismatch: null },
      );
      ctx = r.ctx;
      if (i < 4) expect(ctx.state).toBe(SpinState.BONUS_OR_FREE_SPINS);
      else {
        expect(ctx.state).toBe(SpinState.IDLE);
        expect(r.effects).toContain(EffectType.FEATURE_COMPLETE);
        expect(ctx.freeSpins).toBeNull();
      }
    }
  });

  it('an error during a free spin gives the spin back and RECOVER resumes the feature', () => {
    const ctx: SlotContext = {
      ...createInitialContext(cfg),
      state: SpinState.BONUS_OR_FREE_SPINS,
      freeSpins: { remaining: 3, total: 5, played: 2, totalWin: 0, multiplier: 2 },
    };
    const started = run(ctx, { type: E.BONUS_CONTINUE }).ctx;
    expect(started.freeSpins?.remaining).toBe(2);
    const err = run(started, {
      type: E.OUTCOME_RECEIVED,
      response: { ok: false, spinId: started.spinId, error: { code: 'NETWORK', message: 'x', recoverable: true } },
    }).ctx;
    expect(err.freeSpins?.remaining).toBe(3);
    expect(run(err, { type: E.RECOVER }).ctx.state).toBe(SpinState.BONUS_OR_FREE_SPINS);
  });
});
