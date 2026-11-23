import { EvaluationKind, SymbolKind, type GameConfig, type SymbolDef } from './config';
import type { Grid, Position } from './grid';

export const WinKind = {
  LINE: 'line',
  WAYS: 'ways',
  SCATTER: 'scatter',
} as const;
export type WinKind = (typeof WinKind)[keyof typeof WinKind];

export type Win = {
  readonly kind: WinKind;
  readonly symbolId: string;
  readonly count: number;
  /** Number of ways (1 for line and scatter wins). */
  readonly ways: number;
  /** Payline index for line wins, otherwise null. */
  readonly lineIndex: number | null;
  readonly positions: readonly Position[];
  /** Integer minor units, already including any multiplier. */
  readonly amount: number;
};

export type Evaluated = {
  readonly wins: readonly Win[];
  readonly totalWin: number;
  readonly scatterCount: number;
  readonly scatterPositions: readonly Position[];
  readonly freeSpinsAwarded: number;
};

type SymbolIndex = ReadonlyMap<string, SymbolDef>;

const indexSymbols = (config: GameConfig): SymbolIndex => new Map(config.symbols.map((s) => [s.id, s]));

const payFor = (sym: SymbolDef | undefined, count: number): number => sym?.pays[count] ?? 0;

/** Money is integer minor units; round once per win. */
const toAmount = (multiplier: number, coinValue: number, ways: number, globalMultiplier: number): number =>
  Math.round(multiplier * coinValue * ways * globalMultiplier);

export function evaluateGrid(config: GameConfig, grid: Grid, bet: number, multiplier = 1): Evaluated {
  const symbols = indexSymbols(config);
  const coinValue = bet / config.evaluation.betDivisor;
  const wins: Win[] =
    config.evaluation.kind === EvaluationKind.LINES
      ? evaluateLines(config.evaluation.lines, grid, symbols, coinValue, multiplier)
      : evaluateWays(config, grid, symbols, coinValue, multiplier);

  // Scatters pay anywhere, as a multiple of the TOTAL bet.
  const scatterDef = config.symbols.find((s) => s.kind === SymbolKind.SCATTER);
  const scatterPositions: Position[] = [];
  if (scatterDef) {
    grid.forEach((col, reel) =>
      col.forEach((id, row) => {
        if (id === scatterDef.id) scatterPositions.push({ reel, row });
      }),
    );
    const scatterPay = payFor(scatterDef, scatterPositions.length);
    if (scatterPay > 0) {
      wins.push({
        kind: WinKind.SCATTER,
        symbolId: scatterDef.id,
        count: scatterPositions.length,
        ways: 1,
        lineIndex: null,
        positions: scatterPositions,
        amount: toAmount(scatterPay, bet, 1, multiplier),
      });
    }
  }

  const freeSpinsAwarded = scatterDef && scatterPositions.length >= config.freeSpins.scatterCount ? config.freeSpins.awarded : 0;
  const totalWin = wins.reduce((sum, w) => sum + w.amount, 0);
  return { wins, totalWin, scatterCount: scatterPositions.length, scatterPositions, freeSpinsAwarded };
}

function evaluateLines(
  lines: readonly (readonly number[])[],
  grid: Grid,
  symbols: SymbolIndex,
  coinValue: number,
  multiplier: number,
): Win[] {
  const wins: Win[] = [];
  const kindOf = (id: string | undefined) => (id === undefined ? undefined : symbols.get(id)?.kind);

  lines.forEach((line, lineIndex) => {
    const ids = line.map((row, reel) => grid[reel]?.[row]);

    // Candidate 1: the first non-wild symbol, with wilds substituting. Scatters never pay on lines.
    const target = ids.find((id) => kindOf(id) !== SymbolKind.WILD);
    let best: { id: string; count: number; amount: number } | null = null;

    if (target !== undefined && kindOf(target) === SymbolKind.REGULAR) {
      let count = 0;
      for (const id of ids) {
        if (id === target || kindOf(id) === SymbolKind.WILD) count++;
        else break;
      }
      const amount = toAmount(payFor(symbols.get(target), count), coinValue, 1, multiplier);
      if (amount > 0) best = { id: target, count, amount };
    }

    // Candidate 2: a leading run of wilds paying as wilds (if the wild has its own pays).
    const firstId = ids[0];
    if (firstId !== undefined && kindOf(firstId) === SymbolKind.WILD) {
      let count = 0;
      for (const id of ids) {
        if (kindOf(id) === SymbolKind.WILD) count++;
        else break;
      }
      const amount = toAmount(payFor(symbols.get(firstId), count), coinValue, 1, multiplier);
      if (amount > 0 && (best === null || amount > best.amount)) best = { id: firstId, count, amount };
    }

    if (best) {
      wins.push({
        kind: WinKind.LINE,
        symbolId: best.id,
        count: best.count,
        ways: 1,
        lineIndex,
        positions: line.slice(0, best.count).map((row, reel) => ({ reel, row })),
        amount: best.amount,
      });
    }
  });
  return wins;
}

function evaluateWays(config: GameConfig, grid: Grid, symbols: SymbolIndex, coinValue: number, multiplier: number): Win[] {
  const wins: Win[] = [];
  const isWild = (id: string) => symbols.get(id)?.kind === SymbolKind.WILD;

  for (const sym of config.symbols) {
    if (sym.kind !== SymbolKind.REGULAR) continue;
    let ways = 1;
    let count = 0;
    const positions: Position[] = [];
    for (let reel = 0; reel < grid.length; reel++) {
      const col = grid[reel] ?? [];
      const matchRows: number[] = [];
      col.forEach((id, row) => {
        if (id === sym.id || isWild(id)) matchRows.push(row);
      });
      if (matchRows.length === 0) break;
      ways *= matchRows.length;
      count++;
      for (const row of matchRows) positions.push({ reel, row });
    }
    const pay = payFor(sym, count);
    // A win needs at least one real symbol, not only substituting wilds.
    const hasReal = positions.some((p) => grid[p.reel]?.[p.row] === sym.id);
    if (pay > 0 && hasReal) {
      wins.push({
        kind: WinKind.WAYS,
        symbolId: sym.id,
        count,
        ways,
        lineIndex: null,
        positions,
        amount: toAmount(pay, coinValue, ways, multiplier),
      });
    }
  }
  return wins;
}

/**
 * Reels that should "tease" (spin longer, with anticipation FX): once `scatterCount - 1` scatters
 * have landed on earlier reels and the feature isn't triggered yet.
 */
export function computeTeaseReels(config: GameConfig, grid: Grid): number[] {
  const scatter = config.symbols.find((s) => s.kind === SymbolKind.SCATTER);
  if (!scatter) return [];
  const need = config.freeSpins.scatterCount;
  const tease: number[] = [];
  let seen = 0;
  for (let reel = 0; reel < grid.length; reel++) {
    if (seen >= need - 1 && seen < need) tease.push(reel);
    seen += (grid[reel] ?? []).filter((id) => id === scatter.id).length;
  }
  return tease;
}

export const WinTier = {
  NONE: 'none',
  SMALL: 'small',
  BIG: 'big',
  MEGA: 'mega',
  EPIC: 'epic',
} as const;
export type WinTier = (typeof WinTier)[keyof typeof WinTier];

/** Thresholds as multiples of the bet. */
export const WIN_TIER_THRESHOLDS = { big: 10, mega: 25, epic: 50 } as const;

export function winTier(totalWin: number, bet: number): WinTier {
  if (totalWin <= 0 || bet <= 0) return WinTier.NONE;
  const x = totalWin / bet;
  if (x >= WIN_TIER_THRESHOLDS.epic) return WinTier.EPIC;
  if (x >= WIN_TIER_THRESHOLDS.mega) return WinTier.MEGA;
  if (x >= WIN_TIER_THRESHOLDS.big) return WinTier.BIG;
  return WinTier.SMALL;
}
