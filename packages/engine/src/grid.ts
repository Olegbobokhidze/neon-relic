import { SymbolKind, type GameConfig, type SymbolDef } from './config';
import { pickWeighted, type Rng } from './rng';

/** Symbol ids indexed as grid[reel][row]; row 0 is the top row. */
export type Grid = readonly (readonly string[])[];

export type Position = { readonly reel: number; readonly row: number };

export type GridOptions = {
  /** Remove scatters entirely (useful for building forced scenarios). */
  readonly excludeScatter?: boolean;
};

/** Random grid with at most one scatter per reel (a common maths constraint). */
export function generateGrid(config: GameConfig, rng: Rng, options: GridOptions = {}): string[][] {
  const { reels, rows } = config.layout;
  const all = config.symbols;
  const noScatter = all.filter((s) => s.kind !== SymbolKind.SCATTER);
  const grid: string[][] = [];
  for (let r = 0; r < reels; r++) {
    const column: string[] = [];
    let scatterPlaced = false;
    for (let row = 0; row < rows; row++) {
      const pool: readonly SymbolDef[] = options.excludeScatter || scatterPlaced ? noScatter : all;
      const sym = pickWeighted(rng, pool, (s) => s.weight);
      if (sym.kind === SymbolKind.SCATTER) scatterPlaced = true;
      column.push(sym.id);
    }
    grid.push(column);
  }
  return grid;
}

export function cloneGrid(grid: Grid): string[][] {
  return grid.map((col) => [...col]);
}

export function gridCell(grid: Grid, pos: Position): string | undefined {
  return grid[pos.reel]?.[pos.row];
}
