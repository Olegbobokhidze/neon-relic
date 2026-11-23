import { describe, expect, it } from 'vitest';
import { linesConfig, makeGrid, waysConfig } from './__fixtures__/configs';
import { computeTeaseReels, evaluateGrid, winTier } from './evaluate';
import { validateConfig } from './config';
import { createRng } from './rng';
import { generateGrid } from './grid';

// bet 100, betDivisor 10 → coin value 10.
const BET = 100;

describe('evaluateGrid — lines', () => {
  it('pays nothing on a blank grid', () => {
    const r = evaluateGrid(linesConfig, makeGrid(5, 3, 'X'), BET);
    expect(r.totalWin).toBe(0);
    expect(r.wins).toHaveLength(0);
  });

  it('pays a 3-of-a-kind on the middle line', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 1, 'H'],
      [1, 1, 'H'],
      [2, 1, 'H'],
    ]);
    const r = evaluateGrid(linesConfig, grid, BET);
    expect(r.wins).toHaveLength(1);
    expect(r.wins[0]).toMatchObject({ kind: 'line', symbolId: 'H', count: 3, lineIndex: 0, amount: 10 * 10 });
    expect(r.wins[0]?.positions).toEqual([
      { reel: 0, row: 1 },
      { reel: 1, row: 1 },
      { reel: 2, row: 1 },
    ]);
  });

  it('wilds substitute, including in the leading position', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'W'],
      [1, 0, 'H'],
      [2, 0, 'W'],
      [3, 0, 'H'],
    ]);
    const r = evaluateGrid(linesConfig, grid, BET);
    expect(r.wins[0]).toMatchObject({ symbolId: 'H', count: 4, lineIndex: 1, amount: 20 * 10 });
  });

  it('a pure wild run pays as wild when that beats the substituted symbol', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 2, 'W'],
      [1, 2, 'W'],
      [2, 2, 'W'],
      [3, 2, 'L'],
    ]);
    // Wild 3 = 50 coins; L×4 via substitution = 2 coins → wild wins.
    const r = evaluateGrid(linesConfig, grid, BET);
    expect(r.wins[0]).toMatchObject({ symbolId: 'W', count: 3, amount: 500 });
  });

  it('scatters pay anywhere on total bet and award free spins', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'S'],
      [2, 2, 'S'],
      [4, 1, 'S'],
    ]);
    const r = evaluateGrid(linesConfig, grid, BET);
    expect(r.scatterCount).toBe(3);
    expect(r.freeSpinsAwarded).toBe(5);
    expect(r.wins.find((w) => w.kind === 'scatter')?.amount).toBe(2 * BET);
  });

  it('applies the free-spin multiplier', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 1, 'H'],
      [1, 1, 'H'],
      [2, 1, 'H'],
    ]);
    expect(evaluateGrid(linesConfig, grid, BET, 2).totalWin).toBe(200);
  });
});

describe('evaluateGrid — ways', () => {
  it('multiplies ways across adjacent reels', () => {
    // H on reel0 rows 0,1; reel1 row 2; reel2 rows 0,1,2 → 2×1×3 = 6 ways of 3.
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'H'],
      [0, 1, 'H'],
      [1, 2, 'H'],
      [2, 0, 'H'],
      [2, 1, 'H'],
      [2, 2, 'W'],
    ]);
    const r = evaluateGrid(waysConfig, grid, BET);
    const h = r.wins.find((w) => w.symbolId === 'H');
    expect(h).toMatchObject({ kind: 'ways', count: 3, ways: 6, amount: 10 * 10 * 6 });
  });

  it('does not pay a symbol that appears only through wilds', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'W'],
      [1, 0, 'W'],
      [2, 0, 'W'],
    ]);
    const r = evaluateGrid(waysConfig, grid, BET);
    expect(r.wins.find((w) => w.symbolId === 'H')).toBeUndefined();
  });
});

describe('tease + tiers', () => {
  it('teases remaining reels after scatterCount-1 scatters land', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'S'],
      [1, 1, 'S'],
    ]);
    expect(computeTeaseReels(linesConfig, grid)).toEqual([2, 3, 4]);
  });

  it('stops teasing once the feature has triggered', () => {
    const grid = makeGrid(5, 3, 'X', [
      [0, 0, 'S'],
      [1, 1, 'S'],
      [2, 1, 'S'],
    ]);
    expect(computeTeaseReels(linesConfig, grid)).toEqual([2]);
  });

  it('classifies win tiers by bet multiple', () => {
    expect(winTier(0, 100)).toBe('none');
    expect(winTier(500, 100)).toBe('small');
    expect(winTier(1000, 100)).toBe('big');
    expect(winTier(2500, 100)).toBe('mega');
    expect(winTier(5000, 100)).toBe('epic');
  });
});

describe('rng + grid determinism', () => {
  it('same seed → same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('same seed → same grid, at most one scatter per reel', () => {
    const g1 = generateGrid(linesConfig, createRng(7));
    const g2 = generateGrid(linesConfig, createRng(7));
    expect(g1).toEqual(g2);
    for (let seed = 0; seed < 200; seed++) {
      for (const col of generateGrid(linesConfig, createRng(seed))) expect(col.filter((id) => id === 'S').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('validateConfig', () => {
  it('accepts the fixtures', () => {
    expect(validateConfig(linesConfig).ok).toBe(true);
    expect(validateConfig(waysConfig).ok).toBe(true);
  });

  it('reports readable errors', () => {
    const bad = { ...linesConfig, evaluation: { kind: 'lines', betDivisor: 10, lines: [[0, 1, 5]] } } as const;
    const r = validateConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('expected 5'))).toBe(true);
      expect(r.errors.some((e) => e.includes('row 5'))).toBe(true);
    }
  });
});
