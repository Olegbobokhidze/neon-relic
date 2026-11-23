import type { GameConfig } from '@slot/engine';
import { crystalWays } from './crystal-ways';
import { neonRelic } from './neon-relic';

export { crystalWays, neonRelic };

export const GAME_CONFIGS: readonly GameConfig[] = [neonRelic, crystalWays];

export const DEFAULT_CONFIG_ID = neonRelic.id;

export function getConfig(id: string): GameConfig | undefined {
  return GAME_CONFIGS.find((c) => c.id === id);
}
