import type { GameConfig, SymbolDef } from '../config';

const art = { shape: 'card', glyph: '?', color: '#fff', accent: '#000' } as const;

const symbols: readonly SymbolDef[] = [
  { id: 'W', name: 'Wild', kind: 'wild', weight: 1, pays: { 3: 50, 4: 100, 5: 500 }, art },
  { id: 'S', name: 'Scatter', kind: 'scatter', weight: 1, pays: { 3: 2, 4: 5, 5: 10 }, art },
  { id: 'H', name: 'High', kind: 'regular', weight: 2, pays: { 3: 10, 4: 20, 5: 100 }, art },
  { id: 'L', name: 'Low', kind: 'regular', weight: 4, pays: { 3: 1, 4: 2, 5: 5 }, art },
  { id: 'X', name: 'Blank', kind: 'regular', weight: 4, pays: {}, art },
];

const baseTheme = {
  name: 'test',
  background: '#000',
  backgroundAccent: '#000',
  reelBackground: '#000',
  frame: '#fff',
  glow: '#fff',
  text: '#fff',
  textMuted: '#aaa',
  primary: '#f0f',
  primaryText: '#000',
  win: '#ff0',
  danger: '#f00',
  lineColors: ['#ff0'],
  fontDisplay: 'sans-serif',
};

export const linesConfig: GameConfig = {
  id: 'test-lines',
  title: 'Test Lines',
  version: '0.0.0',
  currency: 'USD',
  startingBalance: 10_000,
  layout: { reels: 5, rows: 3 },
  symbols,
  evaluation: {
    kind: 'lines',
    betDivisor: 10,
    lines: [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
      [2, 2, 2, 2, 2],
    ],
  },
  freeSpins: { scatterCount: 3, awarded: 5, multiplier: 2 },
  bet: { presets: [10, 100, 1000], defaultIndex: 1 },
  timing: { minSpinMs: 1000, turboMinSpinMs: 200, reelStopStaggerMs: 100, teaseExtraMs: 800, bonusIntroMs: 2000, autoSpinDelayMs: 300 },
  theme: baseTheme,
};

export const waysConfig: GameConfig = {
  ...linesConfig,
  id: 'test-ways',
  title: 'Test Ways',
  layout: { reels: 5, rows: 3 },
  evaluation: { kind: 'ways', betDivisor: 10 },
};

/** Fill a reels×rows grid with `fill`, then apply overrides as [reel, row, id]. */
export function makeGrid(reels: number, rows: number, fill: string, overrides: readonly [number, number, string][] = []): string[][] {
  const g = Array.from({ length: reels }, () => Array.from({ length: rows }, () => fill));
  for (const [reel, row, id] of overrides) {
    const col = g[reel];
    if (col) col[row] = id;
  }
  return g;
}
