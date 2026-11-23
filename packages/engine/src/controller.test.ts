import { describe, expect, it } from 'vitest';
import { linesConfig, makeGrid } from './__fixtures__/configs';
import { createManualClock } from './clock';
import { SlotController } from './controller';
import { buildOutcome } from './outcome';
import type { OutcomeProvider, ReelsPort, SpinRequest, SpinResponse } from './ports';
import { SpinState } from './state-machine';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type Deferred = { req: SpinRequest; resolve: (r: SpinResponse) => void };

function manualProvider() {
  const calls: Deferred[] = [];
  let wallet = 10_000;
  const provider: OutcomeProvider = {
    id: 'manual',
    spin: (req) => new Promise((resolve) => calls.push({ req, resolve })),
    getBalance: () => Promise.resolve(wallet),
  };
  const answer = (i: number, grid = makeGrid(5, 3, 'X')) => {
    const call = calls[i];
    if (!call) throw new Error(`no call ${i}`);
    const outcome = buildOutcome(linesConfig, grid, call.req.bet, call.req.mode);
    wallet = wallet - (call.req.mode === 'base' ? call.req.bet : 0) + outcome.totalWin;
    call.resolve({ ok: true, spinId: call.req.spinId, outcome, balanceAfter: wallet });
  };
  return { provider, calls, answer };
}

function recordingReels() {
  const log: string[] = [];
  const reels: ReelsPort = {
    start: () => void log.push('start'),
    stop: (_g, o) => {
      log.push(`stop quick=${o.quick} tease=${o.teaseReels.join(',')}`);
      return Promise.resolve();
    },
    skip: () => void log.push('skip'),
    abort: () => void log.push('abort'),
    presentWins: (p) => {
      log.push(`present ${p.totalWin}`);
      return Promise.resolve();
    },
    skipPresentation: () => void log.push('skipPresentation'),
  };
  return { reels, log };
}

function setup() {
  const clock = createManualClock();
  const { provider, calls, answer } = manualProvider();
  const { reels, log } = recordingReels();
  const controller = new SlotController({
    config: linesConfig,
    provider,
    clock,
    reels,
    requestTimeoutMs: 5000,
    isoNow: () => '2026-11-23T00:00:00Z',
  });
  return { controller, clock, calls, answer, log };
}

describe('SlotController', () => {
  it('runs a full round through ports and settles to IDLE', async () => {
    const { controller, clock, answer, log } = setup();
    controller.spin();
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.SPIN_REQUESTED);
    clock.advance(300);
    answer(0);
    await flush();
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.SPINNING);
    clock.advance(700); // 300 + 700 = minSpinMs 1000
    await flush();
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.IDLE);
    expect(log).toEqual(['start', 'stop quick=false tease=']);
    expect(controller.getSnapshot().ctx.balance).toBe(9_900);
  });

  it('ignores rapid double-taps: one request, one debit, rejections recorded', async () => {
    const { controller, calls } = setup();
    controller.spin();
    controller.spin();
    controller.spin();
    expect(calls).toHaveLength(1);
    expect(controller.getSnapshot().ctx.balance).toBe(9_900);
    const rejected = controller.getHistory().filter((r) => !r.accepted);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.detail).toBe('NOT_ALLOWED_IN_STATE');
  });

  it('times out, refunds, and treats the late response as stale', async () => {
    const { controller, clock, answer } = setup();
    controller.spin();
    clock.advance(5000);
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.ERROR_RECOVERABLE);
    expect(controller.getSnapshot().ctx.error?.code).toBe('TIMEOUT');
    expect(controller.getSnapshot().ctx.balance).toBe(10_000);

    controller.recover();
    await flush();
    controller.spin(); // spinId 2
    answer(0); // late answer for spinId 1
    await flush();
    const last = controller.getHistory().at(-1);
    expect(last).toMatchObject({ event: 'OUTCOME_RECEIVED', accepted: false, detail: 'STALE_SPIN_ID' });
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.SPIN_REQUESTED);
  });

  it('slam-stop while spinning cancels the min-spin timer and stops quick', async () => {
    const { controller, clock, answer, log } = setup();
    controller.spin();
    answer(0);
    await flush();
    controller.spinOrStop();
    await flush();
    expect(log).toContain('stop quick=true tease=');
    expect(clock.pendingTimers()).toBe(0);
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.IDLE);
  });

  it('presents wins and drives autoplay with the clock', async () => {
    const { controller, clock, calls, answer, log } = setup();
    controller.startAuto(2, false);
    const win = makeGrid(5, 3, 'X', [
      [0, 1, 'H'],
      [1, 1, 'H'],
      [2, 1, 'H'],
    ]);
    answer(0, win);
    await flush();
    clock.advance(1000);
    await flush();
    expect(log).toContain('present 100');
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.IDLE);
    clock.advance(linesConfig.timing.autoSpinDelayMs);
    expect(calls).toHaveLength(2);
    answer(1);
    await flush();
    clock.advance(1000);
    await flush();
    expect(controller.getSnapshot().ctx.autoSpin).toBeNull();
    clock.advance(10_000);
    expect(calls).toHaveLength(2);
  });

  it('loadConfig is refused mid-round', () => {
    const { controller } = setup();
    controller.spin();
    expect(controller.loadConfig({ ...linesConfig, id: 'other' })).toBe(false);
  });

  it('a throwing renderer never wedges the state machine', async () => {
    const clock = createManualClock();
    const { provider, answer } = manualProvider();
    const broken: ReelsPort = {
      start: () => {
        throw new Error('boom');
      },
      stop: () => Promise.reject(new Error('boom')),
      skip: () => undefined,
      abort: () => undefined,
      presentWins: () => Promise.reject(new Error('boom')),
      skipPresentation: () => undefined,
    };
    const controller = new SlotController({ config: linesConfig, provider, clock, reels: broken });
    controller.spin();
    answer(0);
    await flush();
    clock.advance(2000);
    await flush();
    expect(controller.getSnapshot().ctx.state).toBe(SpinState.IDLE);
  });
});
