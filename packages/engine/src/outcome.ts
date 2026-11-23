import type { GameConfig } from './config';
import { evaluateGrid, type Win } from './evaluate';
import { generateGrid, type Grid } from './grid';
import type { Rng } from './rng';

export const SpinMode = {
  BASE: 'base',
  FREE: 'free',
} as const;
export type SpinMode = (typeof SpinMode)[keyof typeof SpinMode];

/** What a server returns for one spin, before wallet data is attached. */
export type SpinOutcome = {
  readonly grid: Grid;
  readonly wins: readonly Win[];
  readonly totalWin: number;
  readonly scatterCount: number;
  readonly freeSpinsAwarded: number;
  readonly multiplier: number;
  readonly mode: SpinMode;
};

export function buildOutcome(config: GameConfig, grid: Grid, bet: number, mode: SpinMode): SpinOutcome {
  const multiplier = mode === SpinMode.FREE ? config.freeSpins.multiplier : 1;
  const ev = evaluateGrid(config, grid, bet, multiplier);
  return {
    grid,
    wins: ev.wins,
    totalWin: ev.totalWin,
    scatterCount: ev.scatterCount,
    freeSpinsAwarded: ev.freeSpinsAwarded,
    multiplier,
    mode,
  };
}

/** Reference "server" outcome generation, used by MockProvider and simulations. */
export function generateOutcome(config: GameConfig, bet: number, mode: SpinMode, rng: Rng): SpinOutcome {
  return buildOutcome(config, generateGrid(config, rng), bet, mode);
}
