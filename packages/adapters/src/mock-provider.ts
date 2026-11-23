import {
  buildOutcome,
  createRng,
  ProviderErrorCode,
  type GameConfig,
  type OutcomeProvider,
  type Rng,
  type SpinRequest,
  type SpinResponse,
} from '@slot/engine';
import { ForcedScenario, scenarioGrid } from './scenarios';

export type MockSettings = {
  /** Uniform random latency range in ms. */
  readonly latencyMs: readonly [number, number];
  /** Probability [0..1] of a random NETWORK error. */
  readonly errorRate: number;
  readonly seed: number;
  readonly forced: ForcedScenario;
  /** Reset `forced` to NONE after it has been used once. */
  readonly forcedOnce: boolean;
};

export const DEFAULT_MOCK_SETTINGS: MockSettings = {
  latencyMs: [180, 420],
  errorRate: 0,
  seed: 20261123,
  forced: ForcedScenario.NONE,
  forcedOnce: true,
};

export type MockProviderOptions = {
  readonly resolveConfig: (id: string) => GameConfig | undefined;
  readonly balance: number;
  readonly settings?: Partial<MockSettings>;
  /** Injectable delay, so tests don't wait on real time. */
  readonly delay?: (ms: number) => Promise<void>;
};

const defaultDelay = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * An in-browser stand-in for a remote game server (RGS). It owns its own wallet and RNG, so the
 * client can't cheat its way to an outcome, exactly as it would be against a real backend.
 */
export class MockProvider implements OutcomeProvider {
  readonly id = 'mock';
  private settings: MockSettings;
  private rng: Rng;
  private wallet: number;
  private readonly resolveConfig: (id: string) => GameConfig | undefined;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly listeners = new Set<() => void>();

  constructor(options: MockProviderOptions) {
    this.settings = { ...DEFAULT_MOCK_SETTINGS, ...options.settings };
    this.rng = createRng(this.settings.seed);
    this.wallet = options.balance;
    this.resolveConfig = options.resolveConfig;
    this.delay = options.delay ?? defaultDelay;
  }

  getSettings(): MockSettings {
    return this.settings;
  }

  updateSettings(patch: Partial<MockSettings>): void {
    const reseed = patch.seed !== undefined && patch.seed !== this.settings.seed;
    this.settings = { ...this.settings, ...patch };
    if (reseed) this.rng = createRng(this.settings.seed);
    this.notify();
  }

  /** Subscribe to settings/wallet changes (inspector). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getWallet(): number {
    return this.wallet;
  }

  setWallet(balance: number): void {
    this.wallet = Math.max(0, Math.round(balance));
    this.notify();
  }

  getBalance(): Promise<number> {
    return Promise.resolve(this.wallet);
  }

  async spin(req: SpinRequest): Promise<SpinResponse> {
    const scenario = this.consumeScenario();
    const [min, max] = this.settings.latencyMs;
    const latency = min + this.rng.next() * Math.max(0, max - min);

    if (scenario === ForcedScenario.TIMEOUT) {
      // Simulate a server that never answers in time (the response arrives far too late).
      await this.delay(30_000);
      return this.fail(req, ProviderErrorCode.TIMEOUT, 'Late response after client timeout.');
    }

    await this.delay(latency);

    if (scenario === ForcedScenario.NETWORK_ERROR || (scenario === ForcedScenario.NONE && this.rng.next() < this.settings.errorRate)) {
      return this.fail(req, ProviderErrorCode.NETWORK, 'Connection lost while contacting the game server.');
    }

    const config = this.resolveConfig(req.configId);
    if (!config) return this.fail(req, ProviderErrorCode.VALIDATION, `Unknown game "${req.configId}".`, false);
    if (!config.bet.presets.includes(req.bet)) return this.fail(req, ProviderErrorCode.VALIDATION, `Bet ${req.bet} is not allowed.`);

    const debit = req.mode === 'base' ? req.bet : 0;
    if (scenario === ForcedScenario.INSUFFICIENT_FUNDS || this.wallet < debit) {
      return this.fail(req, ProviderErrorCode.INSUFFICIENT_FUNDS, 'Insufficient funds on the server wallet.');
    }

    const grid = scenarioGrid(config, scenario, this.rng);
    let outcome = buildOutcome(config, grid, req.bet, req.mode);
    this.wallet = this.wallet - debit + outcome.totalWin;

    if (scenario === ForcedScenario.CORRUPT_PAYLOAD) {
      // A buggy server reports a win the grid doesn't support; the client cross-check must catch it.
      outcome = { ...outcome, totalWin: outcome.totalWin + req.bet * 7 };
    }

    this.notify();
    return { ok: true, spinId: req.spinId, outcome, balanceAfter: this.wallet };
  }

  private consumeScenario(): ForcedScenario {
    const scenario = this.settings.forced;
    if (scenario !== ForcedScenario.NONE && this.settings.forcedOnce) {
      this.settings = { ...this.settings, forced: ForcedScenario.NONE };
      this.notify();
    }
    return scenario;
  }

  private fail(req: SpinRequest, code: ProviderErrorCode, message: string, recoverable = true): SpinResponse {
    return { ok: false, spinId: req.spinId, error: { code, message, recoverable } };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
