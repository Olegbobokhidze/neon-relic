import { BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
import { createMotion, forceSettle, normalisedSpeed, planStop, ReelPhase, startMotion, stepMotion, visibleIndices, type MotionParams, type ReelMotion } from './reel-math';
import { SYMBOL_TEXTURE_SIZE, type SymbolTextures } from './symbol-textures';

export type ReelOptions = {
  readonly index: number;
  readonly rows: number;
  readonly textures: SymbolTextures;
  /** Random filler symbol for strip positions that are not part of an outcome. */
  readonly filler: () => string;
  readonly motionBlur: boolean;
};

/**
 * One reel column: a virtual, unbounded strip (Map index → symbol id) rendered through a fixed
 * pool of `rows + 2` sprites. No allocation per frame; only texture swaps and y offsets.
 */
export class Reel {
  readonly view = new Container();
  private readonly symbolLayer = new Container();
  private readonly teaseFx = new Graphics();
  private readonly sprites: Sprite[] = [];
  private readonly strip = new Map<number, string>();
  private readonly blur: BlurFilter | null;
  private motion: ReelMotion = createMotion(0);
  private cellW = 100;
  private cellH = 100;
  private baseScale = 1;
  private startDelay = 0;
  private stopDelay: number | null = null;
  private pendingColumn: readonly string[] | null = null;
  private pendingScale = 1;
  private teaseTime = 0;
  teasing = false;
  /** Rows (0-based) whose sprites are currently highlighted or dimmed by the presenter. */
  private highlight: { readonly winners: ReadonlySet<number>; readonly dim: boolean; pulse: number } | null = null;

  constructor(private readonly opts: ReelOptions) {
    this.blur = opts.motionBlur ? new BlurFilter({ strengthX: 0, strengthY: 0, quality: 2 }) : null;
    for (let i = 0; i < opts.rows + 2; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      this.sprites.push(s);
      this.symbolLayer.addChild(s);
    }
    this.view.addChild(this.teaseFx, this.symbolLayer);
  }

  get index(): number {
    return this.opts.index;
  }

  get isIdle(): boolean {
    return this.motion.phase === ReelPhase.IDLE && this.stopDelay === null && this.startDelay <= 0;
  }

  get hasPlannedStop(): boolean {
    return this.motion.phase === ReelPhase.DECELERATING || this.motion.phase === ReelPhase.SETTLING;
  }

  layout(x: number, y: number, cellW: number, cellH: number): void {
    this.view.position.set(x, y);
    this.cellW = cellW;
    this.cellH = cellH;
    this.baseScale = (Math.min(cellW, cellH) * 0.96) / SYMBOL_TEXTURE_SIZE;
    this.render();
  }

  /** Show a column immediately (initial state, or after a config swap). */
  setColumn(column: readonly string[]): void {
    const p = Math.round(this.motion.position);
    this.motion = createMotion(p, this.motion.params);
    column.forEach((id, row) => this.strip.set(p - row, id));
    this.render();
  }

  start(params: MotionParams, delayMs: number): void {
    this.clearHighlight();
    this.stopDelay = null;
    this.pendingColumn = null;
    this.teasing = false;
    this.startDelay = delayMs;
    startMotion(this.motion, params);
  }

  /** Stop on `column` after `delayMs`. `column === null` stops on filler (error abort). */
  scheduleStop(column: readonly string[] | null, delayMs: number, durationScale = 1): void {
    this.pendingColumn = column;
    this.stopDelay = Math.max(0, delayMs);
    this.pendingScale = durationScale;
  }

  /** Slam: execute the stop now (if not already decelerating) with a short deceleration. */
  hurry(): void {
    this.teasing = false;
    if (this.stopDelay !== null) {
      this.stopDelay = 0;
      this.pendingScale = Math.min(this.pendingScale, 0.35);
    } else if (this.motion.phase === ReelPhase.DECELERATING) {
      forceSettle(this.motion);
    }
  }

  /** Advance one frame. Returns true on the frame this reel comes to rest. */
  update(dtMs: number): boolean {
    if (this.startDelay > 0) {
      this.startDelay -= dtMs;
      if (this.startDelay > 0 && this.stopDelay === null) return false;
      this.startDelay = 0;
    }
    if (this.stopDelay !== null) {
      this.stopDelay -= dtMs;
      if (this.stopDelay <= 0) this.executeStop();
    }

    const stopped = stepMotion(this.motion, dtMs);
    if (stopped) this.teasing = false;
    this.updateTease(dtMs);
    this.render();
    return stopped;
  }

  /** Called by the presenter each frame while presenting wins. */
  setHighlight(winners: ReadonlySet<number> | null, dim: boolean, pulse: number): void {
    this.highlight = winners ? { winners, dim, pulse } : null;
    this.render();
  }

  clearHighlight(): void {
    this.highlight = null;
  }

  private executeStop(): void {
    this.stopDelay = null;
    const target = planStop(this.motion, this.opts.rows + 1, this.pendingScale);
    if (this.pendingColumn) this.pendingColumn.forEach((id, row) => this.strip.set(target - row, id));
    this.pendingColumn = null;
  }

  private updateTease(dtMs: number): void {
    const fx = this.teaseFx;
    if (!this.teasing) {
      if (fx.visible) {
        fx.clear();
        fx.visible = false;
      }
      this.teaseTime = 0;
      return;
    }
    this.teaseTime += dtMs;
    const h = this.cellH * this.opts.rows;
    const a = 0.35 + 0.25 * Math.sin(this.teaseTime / 90);
    fx.visible = true;
    fx.clear()
      .roundRect(2, 2, this.cellW - 4, h - 4, 12)
      .fill({ color: 0xffd23f, alpha: 0.08 + a * 0.12 })
      .stroke({ width: 4, color: 0xffd23f, alpha: a + 0.3 });
  }

  private render(): void {
    const m = this.motion;
    const display = m.position + m.offset;
    const indices = visibleIndices(display, this.opts.rows);
    const cx = this.cellW / 2;
    const cy = this.cellH / 2;

    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      const n = indices[i];
      if (!sprite || n === undefined) continue;
      let id = this.strip.get(n);
      if (id === undefined) {
        id = this.opts.filler();
        this.strip.set(n, id);
      }
      const tex = this.opts.textures.get(id);
      if (sprite.texture !== tex) sprite.texture = tex;
      sprite.position.set(cx, (display - n) * this.cellH + cy);

      // Win highlighting only applies at rest, on integer rows.
      const row = Math.round(display) - n;
      let scale = this.baseScale;
      let alpha = 1;
      if (this.highlight && m.phase === ReelPhase.IDLE) {
        if (this.highlight.winners.has(row)) scale *= 1 + 0.07 * this.highlight.pulse;
        else if (this.highlight.dim) alpha = 0.32;
      }
      sprite.scale.set(scale);
      sprite.alpha = alpha;
    }

    // Motion blur proportional to speed; filters are detached at rest so idle frames stay crisp.
    if (this.blur) {
      const speed = normalisedSpeed(m);
      if (speed > 0.15) {
        this.blur.strengthY = 2 + speed * 10;
        if (!this.symbolLayer.filters) this.symbolLayer.filters = [this.blur];
      } else if (this.symbolLayer.filters) {
        this.symbolLayer.filters = null;
      }
    }

    // Prune strip entries that scrolled far below the window.
    if (this.strip.size > 64) {
      const floor = Math.floor(display) - this.opts.rows - 4;
      for (const k of this.strip.keys()) if (k < floor) this.strip.delete(k);
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.blur?.destroy();
  }
}
