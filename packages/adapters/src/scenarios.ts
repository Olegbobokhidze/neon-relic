import { generateGrid, SymbolKind, type GameConfig, type Rng } from '@slot/engine';

/** QA / demo scenarios the MockProvider can force (ADR-0004). */
export const ForcedScenario = {
  NONE: 'none',
  BIG_WIN: 'bigWin',
  FREE_SPINS: 'freeSpins',
  TEASE: 'tease',
  NO_WIN: 'noWin',
  NETWORK_ERROR: 'networkError',
  TIMEOUT: 'timeout',
  INSUFFICIENT_FUNDS: 'insufficientFunds',
  CORRUPT_PAYLOAD: 'corruptPayload',
} as const;
export type ForcedScenario = (typeof ForcedScenario)[keyof typeof ForcedScenario];

export const SCENARIO_LABELS: Readonly<Record<ForcedScenario, string>> = {
  none: 'None (random)',
  bigWin: 'Big win',
  freeSpins: 'Trigger free spins',
  tease: 'Scatter tease (near miss)',
  noWin: 'No win',
  networkError: 'Network error',
  timeout: 'Timeout (no response)',
  insufficientFunds: 'Insufficient funds',
  corruptPayload: 'Corrupt payload (validation)',
};

/** Spread `count` distinct reels evenly across the layout, e.g. 3 of 5 → [0, 2, 4]. */
function spreadReels(reels: number, count: number): number[] {
  if (count >= reels) return Array.from({ length: reels }, (_, i) => i);
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => Math.round((i * (reels - 1)) / (count - 1)));
}

export function scenarioGrid(config: GameConfig, scenario: ForcedScenario, rng: Rng): string[][] {
  const { reels, rows } = config.layout;
  const scatter = config.symbols.find((s) => s.kind === SymbolKind.SCATTER);
  const wild = config.symbols.find((s) => s.kind === SymbolKind.WILD);
  const regulars = config.symbols.filter((s) => s.kind === SymbolKind.REGULAR);

  switch (scenario) {
    case ForcedScenario.BIG_WIN: {
      const grid = generateGrid(config, rng, { excludeScatter: true });
      const top = regulars[0];
      if (!top) return grid;
      if (config.evaluation.kind === 'lines') {
        const line = config.evaluation.lines[0] ?? [];
        line.forEach((row, reel) => {
          const col = grid[reel];
          if (col) col[row] = reel === 2 && wild ? wild.id : top.id;
        });
      } else {
        // Ways: stack the top symbol on two rows across every reel.
        for (let reel = 0; reel < reels; reel++) {
          const col = grid[reel];
          if (!col) continue;
          col[0] = top.id;
          if (rows > 1) col[1] = reel === 2 && wild ? wild.id : top.id;
        }
      }
      return grid;
    }

    case ForcedScenario.FREE_SPINS: {
      const grid = generateGrid(config, rng, { excludeScatter: true });
      if (!scatter) return grid;
      for (const reel of spreadReels(reels, config.freeSpins.scatterCount)) {
        const col = grid[reel];
        if (col) col[rng.int(rows)] = scatter.id;
      }
      return grid;
    }

    case ForcedScenario.TEASE: {
      const grid = generateGrid(config, rng, { excludeScatter: true });
      if (!scatter) return grid;
      for (let reel = 0; reel < config.freeSpins.scatterCount - 1; reel++) {
        const col = grid[reel];
        if (col) col[rng.int(rows)] = scatter.id;
      }
      return grid;
    }

    case ForcedScenario.NO_WIN: {
      // Retry until the grid pays nothing (bounded): a real server would use a no-win reel set.
      for (let attempt = 0; attempt < 200; attempt++) {
        const grid = generateGrid(config, rng, { excludeScatter: true });
        const firstReel = new Set(grid[0]);
        const secondReel = new Set(grid[1]);
        const hasWild = grid.slice(0, 3).some((col) => col.some((id) => id === wild?.id));
        if (!hasWild && [...firstReel].every((id) => !secondReel.has(id))) return grid;
      }
      return generateGrid(config, rng, { excludeScatter: true });
    }

    default:
      return generateGrid(config, rng);
  }
}
