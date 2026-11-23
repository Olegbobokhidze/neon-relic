import type { GameConfig } from './config';
import { generateOutcome, SpinMode } from './outcome';
import { createRng } from './rng';

export type SimulationReport = {
  readonly spins: number;
  /** Return to player over base-game spins. Free spins are counted, and played out with the multiplier. */
  readonly rtp: number;
  readonly hitRate: number;
  readonly featureRate: number;
  readonly maxWinX: number;
};

/** Monte-Carlo estimate of the maths, so configs can be sanity-checked in CI. */
export function simulate(config: GameConfig, spins: number, seed = 1): SimulationReport {
  const rng = createRng(seed);
  const bet = config.bet.presets[config.bet.defaultIndex] ?? 100;
  let wagered = 0;
  let won = 0;
  let hits = 0;
  let features = 0;
  let maxWin = 0;

  for (let i = 0; i < spins; i++) {
    wagered += bet;
    const base = generateOutcome(config, bet, SpinMode.BASE, rng);
    let roundWin = base.totalWin;
    if (base.totalWin > 0) hits++;
    let freeLeft = base.freeSpinsAwarded;
    if (freeLeft > 0) features++;
    let guard = 0;
    while (freeLeft > 0 && guard++ < 500) {
      freeLeft--;
      const fs = generateOutcome(config, bet, SpinMode.FREE, rng);
      roundWin += fs.totalWin;
      freeLeft += fs.freeSpinsAwarded;
    }
    won += roundWin;
    maxWin = Math.max(maxWin, roundWin);
  }
  return { spins, rtp: won / wagered, hitRate: hits / spins, featureRate: features / spins, maxWinX: maxWin / bet };
}
