import { describe, expect, it } from 'vitest';
import { FrameStats } from './frame-stats';
import { createMotion, NORMAL_MOTION, planStop, ReelPhase, startMotion, stepMotion, visibleIndices } from './reel-math';

const runUntilIdle = (m: ReturnType<typeof createMotion>, dt: number, maxMs = 10_000) => {
  let t = 0;
  while (t < maxMs) {
    t += dt;
    if (stepMotion(m, dt)) return t;
  }
  throw new Error('reel never stopped');
};

describe('reel motion', () => {
  it('reaches cruise speed after wind-up + acceleration', () => {
    const m = createMotion(0);
    startMotion(m, NORMAL_MOTION);
    for (let t = 0; t < NORMAL_MOTION.windUpMs + NORMAL_MOTION.accelMs + 50; t += 16) stepMotion(m, 16);
    expect(m.phase).toBe(ReelPhase.CRUISING);
    expect(m.velocity).toBeCloseTo(NORMAL_MOTION.maxSpeed);
  });

  it('always lands exactly on the planned integer target, independent of frame rate', () => {
    for (const dt of [4, 8.33, 16.67, 33.3, 50]) {
      const m = createMotion(3.7, NORMAL_MOTION);
      startMotion(m, NORMAL_MOTION);
      for (let t = 0; t < 600; t += dt) stepMotion(m, dt);
      const target = planStop(m, 4);
      runUntilIdle(m, dt);
      expect(m.position).toBe(target);
      expect(m.offset).toBe(0);
      expect(m.phase).toBe(ReelPhase.IDLE);
    }
  });

  it('plans the target far enough ahead that target symbols are not yet visible', () => {
    const rows = 3;
    const m = createMotion(10.2, NORMAL_MOTION);
    startMotion(m, NORMAL_MOTION);
    for (let t = 0; t < 600; t += 16) stepMotion(m, 16);
    const visibleNow = visibleIndices(m.position + m.offset, rows);
    const target = planStop(m, rows + 1);
    const targetWindow = [target, target - 1, target - 2];
    for (const n of targetWindow) expect(visibleNow).not.toContain(n);
  });

  it('keeps velocity continuous when deceleration begins', () => {
    const m = createMotion(0, NORMAL_MOTION);
    startMotion(m, NORMAL_MOTION);
    for (let t = 0; t < 800; t += 16) stepMotion(m, 16);
    const before = m.velocity;
    planStop(m, 4);
    stepMotion(m, 1);
    expect(Math.abs(m.velocity - before) / before).toBeLessThan(0.05);
  });
});

describe('FrameStats', () => {
  it('computes fps and percentiles over the ring buffer', () => {
    const s = new FrameStats(10);
    for (let i = 0; i < 20; i++) s.push(i < 19 ? 16 : 40);
    const snap = s.snapshot();
    expect(snap.samples).toHaveLength(10);
    expect(snap.maxMs).toBe(40);
    expect(snap.jank).toBe(1);
    expect(snap.fps).toBeGreaterThan(50);
  });
});
