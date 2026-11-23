/**
 * Composition root: the only place that knows about every package (ADR-0001).
 * Swap MockProvider for HttpProvider here to talk to a real backend (ADR-0004).
 */
import { MockProvider } from '@slot/adapters';
import { bindAudio, SoundManager } from '@slot/audio';
import { createMoneyFormatter, createSystemClock, SlotController, type GameConfig } from '@slot/engine';
import type { ReelStage } from '@slot/renderer-pixi';
import { DEFAULT_CONFIG_ID, getConfig, neonRelic } from '@slot/themes';

export type Holder<T> = {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
};

export function createHolder<T>(initial: T): Holder<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = v;
      for (const l of listeners) l();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Game = {
  readonly controller: SlotController;
  readonly provider: MockProvider;
  readonly sound: SoundManager;
  readonly stage: Holder<ReelStage | null>;
  readonly formatMoney: (minor: number) => string;
  readonly initialInspectorOpen: boolean;
};

function readParams(): { configId: string; inspector: boolean; seed: number | null } {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const seed = Number(q.get('seed'));
  return {
    configId: q.get('config') ?? DEFAULT_CONFIG_ID,
    inspector: q.get('inspector') === '1',
    seed: Number.isFinite(seed) && q.has('seed') ? seed : null,
  };
}

export function createGame(): Game {
  const params = readParams();
  const config: GameConfig = getConfig(params.configId) ?? getConfig(DEFAULT_CONFIG_ID) ?? neonRelic;

  const provider = new MockProvider({
    resolveConfig: getConfig,
    balance: config.startingBalance,
    settings: params.seed !== null ? { seed: params.seed } : {},
  });

  const controller = new SlotController({ config, provider, clock: createSystemClock(), requestTimeoutMs: 8000 });
  const sound = new SoundManager();
  bindAudio(controller, sound);

  // Formatting follows the active config's currency.
  const formatters = new Map<string, (minor: number) => string>();
  const formatMoney = (minor: number) => {
    const currency = controller.getConfig().currency;
    let f = formatters.get(currency);
    if (!f) formatters.set(currency, (f = createMoneyFormatter(currency)));
    return f(minor);
  };

  return { controller, provider, sound, stage: createHolder<ReelStage | null>(null), formatMoney, initialInspectorOpen: params.inspector };
}
