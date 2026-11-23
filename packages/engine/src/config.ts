/**
 * GameConfig: the single source of truth for a title's maths, layout and skin (ADR-0005).
 * All money values are integer minor units (e.g. cents).
 */

export const SymbolKind = {
  REGULAR: 'regular',
  WILD: 'wild',
  SCATTER: 'scatter',
} as const;
export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

/** Procedural art primitives understood by renderers. */
export const SymbolShape = {
  GEM: 'gem',
  ORB: 'orb',
  HEX: 'hex',
  DIAMOND: 'diamond',
  STAR: 'star',
  RUNE: 'rune',
  CARD: 'card',
} as const;
export type SymbolShape = (typeof SymbolShape)[keyof typeof SymbolShape];

export type SymbolArt = {
  readonly shape: SymbolShape;
  readonly glyph: string;
  readonly color: string;
  readonly accent: string;
};

/** Pays table: symbol count → multiplier of the coin value (see `Evaluation.betDivisor`). */
export type PayTable = Readonly<Partial<Record<number, number>>>;

export type SymbolDef = {
  readonly id: string;
  readonly name: string;
  readonly kind: SymbolKind;
  /** Relative probability of this symbol appearing in a cell. */
  readonly weight: number;
  /**
   * Regular/wild: multiplier of coin value (bet / betDivisor), per line or per way.
   * Scatter: multiplier of the TOTAL bet, paid anywhere.
   */
  readonly pays: PayTable;
  readonly art: SymbolArt;
};

export const EvaluationKind = {
  LINES: 'lines',
  WAYS: 'ways',
} as const;
export type EvaluationKind = (typeof EvaluationKind)[keyof typeof EvaluationKind];

export type Evaluation =
  | {
      readonly kind: typeof EvaluationKind.LINES;
      /** Each line lists the row index for every reel, left to right. */
      readonly lines: readonly (readonly number[])[];
      readonly betDivisor: number;
    }
  | {
      readonly kind: typeof EvaluationKind.WAYS;
      readonly betDivisor: number;
    };

export type ThemeTokens = {
  readonly name: string;
  readonly background: string;
  readonly backgroundAccent: string;
  readonly reelBackground: string;
  readonly frame: string;
  readonly glow: string;
  readonly text: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly primaryText: string;
  readonly win: string;
  readonly danger: string;
  readonly lineColors: readonly string[];
  readonly fontDisplay: string;
};

export type GameTiming = {
  /** Minimum time reels spin (from spin start) before stopping. */
  readonly minSpinMs: number;
  readonly turboMinSpinMs: number;
  readonly reelStopStaggerMs: number;
  readonly teaseExtraMs: number;
  readonly bonusIntroMs: number;
  readonly autoSpinDelayMs: number;
};

export type GameConfig = {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly currency: string;
  readonly startingBalance: number;
  readonly layout: { readonly reels: number; readonly rows: number };
  readonly symbols: readonly SymbolDef[];
  readonly evaluation: Evaluation;
  readonly freeSpins: {
    readonly scatterCount: number;
    readonly awarded: number;
    readonly multiplier: number;
  };
  readonly bet: { readonly presets: readonly number[]; readonly defaultIndex: number };
  readonly timing: GameTiming;
  readonly theme: ThemeTokens;
};

export type ConfigValidation =
  | { readonly ok: true; readonly config: GameConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

export function validateConfig(config: GameConfig): ConfigValidation {
  const errors: string[] = [];
  const { reels, rows } = config.layout;

  if (!Number.isInteger(reels) || reels < 3) errors.push(`layout.reels must be an integer >= 3 (got ${reels})`);
  if (!Number.isInteger(rows) || rows < 1) errors.push(`layout.rows must be an integer >= 1 (got ${rows})`);

  const ids = new Set<string>();
  for (const s of config.symbols) {
    if (ids.has(s.id)) errors.push(`duplicate symbol id "${s.id}"`);
    ids.add(s.id);
    if (!(s.weight > 0)) errors.push(`symbol "${s.id}" weight must be > 0`);
    for (const [count, mult] of Object.entries(s.pays)) {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > reels) errors.push(`symbol "${s.id}" pays count ${count} out of range`);
      if (mult === undefined || mult < 0) errors.push(`symbol "${s.id}" pays[${count}] must be >= 0`);
    }
  }
  if (!config.symbols.some((s) => s.kind === SymbolKind.REGULAR)) errors.push('at least one regular symbol is required');
  if (config.symbols.filter((s) => s.kind === SymbolKind.WILD).length > 1) errors.push('at most one wild symbol is supported');
  if (config.symbols.filter((s) => s.kind === SymbolKind.SCATTER).length > 1) errors.push('at most one scatter symbol is supported');

  const ev = config.evaluation;
  if (!(ev.betDivisor > 0)) errors.push('evaluation.betDivisor must be > 0');
  if (ev.kind === EvaluationKind.LINES) {
    if (ev.lines.length === 0) errors.push('lines evaluation requires at least one line');
    ev.lines.forEach((line, i) => {
      if (line.length !== reels) errors.push(`line ${i} has ${line.length} entries, expected ${reels}`);
      line.forEach((row) => {
        if (!Number.isInteger(row) || row < 0 || row >= rows) errors.push(`line ${i} references row ${row} outside 0..${rows - 1}`);
      });
    });
  }

  const { presets, defaultIndex } = config.bet;
  if (presets.length === 0) errors.push('bet.presets must not be empty');
  if (presets.some((p) => !Number.isInteger(p) || p <= 0)) errors.push('bet.presets must be positive integers (minor units)');
  if (presets.some((p, i) => i > 0 && p <= (presets[i - 1] ?? 0))) errors.push('bet.presets must be strictly ascending');
  if (defaultIndex < 0 || defaultIndex >= presets.length) errors.push('bet.defaultIndex out of range');

  if (config.freeSpins.scatterCount < 1 || config.freeSpins.scatterCount > reels) errors.push('freeSpins.scatterCount out of range');
  if (config.freeSpins.multiplier < 1) errors.push('freeSpins.multiplier must be >= 1');
  if (!Number.isInteger(config.startingBalance) || config.startingBalance < 0) errors.push('startingBalance must be a non-negative integer');

  return errors.length === 0 ? { ok: true, config } : { ok: false, errors };
}

export function assertValidConfig(config: GameConfig): GameConfig {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(`Invalid GameConfig "${config.id}":\n  - ${result.errors.join('\n  - ')}`);
  return result.config;
}

export function getSymbol(config: GameConfig, id: string): SymbolDef | undefined {
  return config.symbols.find((s) => s.id === id);
}
