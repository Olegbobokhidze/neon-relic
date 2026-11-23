import { Application, BlurFilter, Container, Graphics, type Ticker } from 'pixi.js';
import {
  createRng,
  generateGrid,
  pickWeighted,
  SymbolKind,
  type GameConfig,
  type Grid,
  type ReelsPort,
  type ReelStopOptions,
  type WinPresentation,
} from '@slot/engine';
import { FrameStats, type FrameStatsSnapshot } from './frame-stats';
import { ParticleBurst } from './particles';
import { Reel } from './reel';
import { NORMAL_MOTION, TURBO_MOTION, type MotionParams } from './reel-math';
import { bakeParticleTexture, bakeSymbolTextures, type SymbolTextures } from './symbol-textures';
import { WinPresenter, type GridGeometry } from './win-presenter';

export type ReelStageEvents = {
  readonly onReelStop?: (reel: number, landedScatter: boolean) => void;
  readonly onTeaseStart?: (reel: number) => void;
  readonly onAllStopped?: () => void;
  readonly onContextLost?: () => void;
};

export type ReelStageOptions = {
  readonly host: HTMLElement;
  readonly config: GameConfig;
  readonly formatMoney: (minor: number) => string;
  readonly events?: ReelStageEvents;
  readonly reducedMotion?: boolean;
};

const hex = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16);

/**
 * PixiJS reel renderer (ADR-0002). One ticker callback drives all motion with delta time;
 * React never touches it per frame. Implements the engine's `ReelsPort`.
 */
export class ReelStage implements ReelsPort {
  readonly stats = new FrameStats(240);
  private readonly app: Application;
  private config: GameConfig;
  private readonly opts: ReelStageOptions;
  private textures: SymbolTextures | null = null;
  private readonly background = new Container();
  private readonly gridLayer = new Container();
  private readonly gridMask = new Graphics();
  private readonly fxLayer = new Container();
  private reels: Reel[] = [];
  private presenter: WinPresenter | null = null;
  private particles: ParticleBurst | null = null;
  private stopResolve: (() => void) | null = null;
  private stopping = false;
  private teaseSet = new Set<number>();
  private finalGrid: Grid | null = null;
  private turbo = false;
  private readonly fillerRng = createRng((Date.now() ^ 0x5eed) >>> 0);
  private geo: GridGeometry | null = null;
  private destroyed = false;
  private readonly tick = (ticker: Ticker) => this.update(ticker);
  private readonly onResize = () => this.layout();

  private constructor(app: Application, opts: ReelStageOptions) {
    this.app = app;
    this.opts = opts;
    this.config = opts.config;
  }

  static async create(opts: ReelStageOptions): Promise<ReelStage> {
    const app = new Application();
    await app.init({
      resizeTo: opts.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    app.canvas.style.display = 'block';
    app.canvas.setAttribute('aria-hidden', 'true');
    opts.host.appendChild(app.canvas);

    // Wait (briefly) for the display font so baked glyphs use it.
    try {
      await Promise.race([
        document.fonts.load(`900 48px ${opts.config.theme.fontDisplay.split(',')[0] ?? 'sans-serif'}`),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
    } catch {
      /* fonts API unavailable: fall back to system font */
    }

    const stage = new ReelStage(app, opts);
    stage.init();
    return stage;
  }

  private init(): void {
    const { stage, canvas } = this.app;
    this.gridLayer.mask = this.gridMask;
    stage.addChild(this.background, this.gridLayer, this.gridMask, this.fxLayer);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.opts.events?.onContextLost?.();
    });
    this.particles = this.opts.reducedMotion ? null : new ParticleBurst(bakeParticleTexture(this.app.renderer));
    this.build(this.config);
    this.app.renderer.on('resize', this.onResize);
    this.app.ticker.add(this.tick);
  }

  /** Rebuild reels and textures for a new config (skin / layout swap). */
  rebuild(config: GameConfig): void {
    if (this.destroyed) return;
    this.config = config;
    this.build(config);
  }

  private build(config: GameConfig): void {
    for (const r of this.reels) r.destroy();
    this.reels = [];
    this.presenter?.view.destroy({ children: true });
    this.fxLayer.removeChildren();
    this.textures?.destroy();
    this.textures = bakeSymbolTextures(this.app.renderer, config);

    const textures = this.textures;
    const fillerPool = config.symbols;
    const filler = () => pickWeighted(this.fillerRng, fillerPool, (s) => (s.kind === SymbolKind.SCATTER ? s.weight * 0.5 : s.weight)).id;
    const initial = generateGrid(config, this.fillerRng, { excludeScatter: true });

    for (let i = 0; i < config.layout.reels; i++) {
      const reel = new Reel({ index: i, rows: config.layout.rows, textures, filler, motionBlur: !this.opts.reducedMotion });
      reel.setColumn(initial[i] ?? []);
      this.reels.push(reel);
      this.gridLayer.addChild(reel.view);
    }
    this.presenter = new WinPresenter(config, () => this.reels, this.particles, this.opts.formatMoney, this.opts.reducedMotion ?? false);
    this.fxLayer.addChild(this.presenter.view);
    if (this.particles) this.fxLayer.addChild(this.particles.view);
    this.layout();
  }

  private layout(): void {
    if (this.destroyed) return;
    const { width, height } = this.app.screen;
    const { reels, rows } = this.config.layout;
    const pad = Math.max(12, Math.min(width, height) * 0.04);
    const cell = Math.floor(Math.min((width - pad * 2) / reels, (height - pad * 2) / rows));
    const gridW = cell * reels;
    const gridH = cell * rows;
    const originX = Math.round((width - gridW) / 2);
    const originY = Math.round((height - gridH) / 2);
    this.geo = { originX, originY, cellW: cell, cellH: cell, width: gridW, height: gridH, stageW: width, stageH: height };

    this.reels.forEach((r, i) => r.layout(originX + i * cell, originY, cell, cell));
    this.gridMask.clear().rect(originX, originY, gridW, gridH).fill({ color: 0xffffff });
    this.drawBackground();
    this.presenter?.layout(this.geo);
  }

  private drawBackground(): void {
    const geo = this.geo;
    if (!geo) return;
    const t = this.config.theme;
    this.background.cacheAsTexture(false);
    this.background.removeChildren().forEach((c) => c.destroy());

    const frame = new Graphics();
    const glow = new Graphics()
      .roundRect(geo.originX - 10, geo.originY - 10, geo.width + 20, geo.height + 20, 22)
      .stroke({ width: 10, color: hex(t.glow), alpha: 0.55 });
    glow.filters = [new BlurFilter({ strength: 18, quality: 3 })];

    frame
      .roundRect(geo.originX - 8, geo.originY - 8, geo.width + 16, geo.height + 16, 20)
      .fill({ color: hex(t.reelBackground), alpha: 0.92 })
      .stroke({ width: 3, color: hex(t.frame), alpha: 0.9 });
    for (let i = 1; i < this.config.layout.reels; i++) {
      const x = geo.originX + i * geo.cellW;
      frame.moveTo(x, geo.originY + 8).lineTo(x, geo.originY + geo.height - 8).stroke({ width: 1, color: hex(t.frame), alpha: 0.14 });
    }
    this.background.addChild(glow, frame);
    // Static: rasterise once per layout instead of re-rendering the blur every frame.
    this.background.cacheAsTexture(true);
  }

  // ---------------------------------------------------------------- ReelsPort

  start(options: { readonly turbo: boolean }): void {
    this.presenter?.clear();
    this.turbo = options.turbo;
    const params = this.motionParams(false);
    const stagger = this.turbo ? 18 : 55;
    this.reels.forEach((r, i) => r.start(params, i * stagger));
  }

  stop(grid: Grid, options: ReelStopOptions): Promise<void> {
    this.finalGrid = grid;
    this.teaseSet = new Set(options.teaseReels);
    this.stopping = true;
    const stagger = options.quick ? 55 : this.config.timing.reelStopStaggerMs;
    let delay = 0;
    this.reels.forEach((reel, i) => {
      if (this.teaseSet.has(i)) delay += this.config.timing.teaseExtraMs;
      reel.scheduleStop(grid[i] ?? null, delay, options.quick ? 0.55 : 1);
      delay += stagger;
    });
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      this.checkAllStopped();
    });
  }

  skip(): void {
    this.teaseSet.clear();
    for (const r of this.reels) r.hurry();
  }

  abort(): void {
    this.finalGrid = null;
    this.teaseSet.clear();
    this.reels.forEach((r, i) => r.scheduleStop(null, i * 40, 0.6));
    this.stopping = false;
    this.resolveStop();
  }

  presentWins(presentation: WinPresentation): Promise<void> {
    return this.presenter?.present(presentation) ?? Promise.resolve();
  }

  skipPresentation(): void {
    this.presenter?.skip();
  }

  // ---------------------------------------------------------------- loop

  private update(ticker: Ticker): void {
    // Motion uses the capped delta; stats use the real elapsed time.
    this.stats.push(ticker.elapsedMS);
    const dt = Math.min(ticker.deltaMS, 50);

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i];
      if (!reel) continue;
      const landed = reel.update(dt);
      if (landed && this.stopping) {
        const col = this.finalGrid?.[i] ?? [];
        const scatter = this.config.symbols.find((s) => s.kind === SymbolKind.SCATTER);
        this.opts.events?.onReelStop?.(i, !!scatter && col.includes(scatter.id));
        const next = this.reels[i + 1];
        if (next && this.teaseSet.has(i + 1) && !next.isIdle) {
          next.teasing = true;
          this.opts.events?.onTeaseStart?.(i + 1);
        }
        this.checkAllStopped();
      }
    }
    this.presenter?.update(dt);
    this.particles?.update(dt);
  }

  private checkAllStopped(): void {
    if (!this.stopping || !this.stopResolve) return;
    if (this.reels.every((r) => r.isIdle)) {
      this.stopping = false;
      this.opts.events?.onAllStopped?.();
      this.resolveStop();
    }
  }

  private resolveStop(): void {
    const r = this.stopResolve;
    this.stopResolve = null;
    r?.();
  }

  private motionParams(quick: boolean): MotionParams {
    if (this.opts.reducedMotion) return { ...TURBO_MOTION, windUp: 0, overshoot: 0.05 };
    return this.turbo || quick ? TURBO_MOTION : NORMAL_MOTION;
  }

  // ---------------------------------------------------------------- public utils

  getStats(): FrameStatsSnapshot {
    return this.stats.snapshot();
  }

  getRendererInfo(): { readonly name: string; readonly resolution: number } {
    const name = this.app.renderer.name;
    return { name, resolution: this.app.renderer.resolution };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resolveStop();
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.onResize);
    for (const r of this.reels) r.destroy();
    this.textures?.destroy();
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }
}
