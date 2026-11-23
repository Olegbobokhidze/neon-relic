import { describe, expect, it } from 'vitest';
import { computeTeaseReels, evaluateGrid } from '@slot/engine';
import { crystalWays, getConfig, neonRelic } from '@slot/themes';
import { MockProvider } from './mock-provider';
import { ForcedScenario } from './scenarios';
import { parseSpinResponse } from './validate';

const make = (forced: ForcedScenario = ForcedScenario.NONE, balance = 100_000) =>
  new MockProvider({ resolveConfig: getConfig, balance, settings: { forced }, delay: () => Promise.resolve() });

const req = (spinId: number, configId = neonRelic.id, bet = 100) => ({ spinId, configId, bet, mode: 'base' as const });

describe('MockProvider', () => {
  it('settles the wallet: balanceAfter = before - bet + win', async () => {
    const p = make();
    const r = await p.spin(req(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.balanceAfter).toBe(100_000 - 100 + r.outcome.totalWin);
  });

  it('is deterministic for a given seed', async () => {
    const a = await make().spin(req(1));
    const b = await make().spin(req(1));
    expect(a).toEqual(b);
  });

  it('rejects bets that are not presets', async () => {
    const r = await make().spin(req(1, neonRelic.id, 123));
    expect(r.ok === false && r.error.code).toBe('VALIDATION');
  });

  it('forced scenarios produce what they promise, on both configs', async () => {
    for (const cfg of [neonRelic, crystalWays]) {
      const bet = cfg.bet.presets[2] ?? 100;
      const big = await make(ForcedScenario.BIG_WIN).spin(req(1, cfg.id, bet));
      expect(big.ok && big.outcome.totalWin >= bet * 10).toBe(true);

      const fs = await make(ForcedScenario.FREE_SPINS).spin(req(1, cfg.id, bet));
      expect(fs.ok && fs.outcome.freeSpinsAwarded).toBe(cfg.freeSpins.awarded);

      const tease = await make(ForcedScenario.TEASE).spin(req(1, cfg.id, bet));
      expect(tease.ok && computeTeaseReels(cfg, tease.outcome.grid).length).toBeGreaterThan(0);
      expect(tease.ok && tease.outcome.freeSpinsAwarded).toBe(0);

      const none = await make(ForcedScenario.NO_WIN).spin(req(1, cfg.id, bet));
      expect(none.ok && none.outcome.totalWin).toBe(0);
    }
  });

  it('forcedOnce resets the scenario after one use', async () => {
    const p = make(ForcedScenario.NETWORK_ERROR);
    expect((await p.spin(req(1))).ok).toBe(false);
    expect(p.getSettings().forced).toBe('none');
    expect((await p.spin(req(2))).ok).toBe(true);
  });

  it('corrupt payload disagrees with client evaluation', async () => {
    const r = await make(ForcedScenario.CORRUPT_PAYLOAD).spin(req(1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(evaluateGrid(neonRelic, r.outcome.grid, 100).totalWin).not.toBe(r.outcome.totalWin);
  });

  it('insufficient wallet funds is a recoverable error', async () => {
    const r = await make(ForcedScenario.NONE, 50).spin(req(1));
    expect(r.ok === false && r.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', recoverable: true });
  });
});

describe('parseSpinResponse', () => {
  it('accepts a real mock payload round-tripped through JSON', async () => {
    const r = await make().spin(req(5));
    const parsed = parseSpinResponse(JSON.parse(JSON.stringify(r)), 5);
    expect(parsed.ok).toBe(true);
  });

  it('rejects mismatched spin ids and malformed shapes', () => {
    expect(parseSpinResponse({ ok: true, spinId: 1 }, 2).ok).toBe(false);
    expect(parseSpinResponse({ ok: true, spinId: 1, balanceAfter: 1, outcome: { grid: 'x' } }, 1).ok).toBe(false);
    expect(parseSpinResponse(null, 1).ok).toBe(false);
  });
});
