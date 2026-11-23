import { describe, expect, it } from 'vitest';
import { simulate, validateConfig } from '@slot/engine';
import { GAME_CONFIGS } from './index';

describe.each(GAME_CONFIGS.map((c) => [c.id, c] as const))('%s', (_id, config) => {
  it('passes validateConfig', () => {
    const r = validateConfig(config);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('has plausible maths (Monte-Carlo, 40k spins)', () => {
    const report = simulate(config, 40_000, 99);
    // Logged so maths tuning is visible in CI output.
    console.info(
      `[${config.id}] RTP ${(report.rtp * 100).toFixed(2)}%  hit ${(report.hitRate * 100).toFixed(1)}%  ` +
        `feature 1/${Math.round(1 / Math.max(report.featureRate, 1e-9))}  max ${report.maxWinX.toFixed(0)}x`,
    );
    expect(report.rtp).toBeGreaterThan(0.85);
    expect(report.rtp).toBeLessThan(1.05);
    expect(report.hitRate).toBeGreaterThan(0.15);
    expect(report.featureRate).toBeGreaterThan(1 / 600);
  });

  it('theme provides enough line colours and readable tokens', () => {
    expect(config.theme.lineColors.length).toBeGreaterThan(0);
    for (const key of ['background', 'text', 'primary', 'win'] as const) expect(config.theme[key]).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});
