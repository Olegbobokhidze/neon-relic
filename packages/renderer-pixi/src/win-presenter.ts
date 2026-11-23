import { Container, Graphics, Text } from 'pixi.js';
import type { GameConfig, Position, Win, WinPresentation, WinTier } from '@slot/engine';
import type { ParticleBurst } from './particles';
import type { Reel } from './reel';

export type GridGeometry = {
  readonly originX: number;
  readonly originY: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly width: number;
  readonly height: number;
  readonly stageW: number;
  readonly stageH: number;
};

const TIER_LABEL: Partial<Record<WinTier, string>> = { big: 'BIG WIN', mega: 'MEGA WIN', epic: 'EPIC WIN' };
const TIER_MS: Partial<Record<WinTier, number>> = { big: 2400, mega: 3400, epic: 4400 };

const hex = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

type Phase =
  | { kind: 'idle' }
  | { kind: 'summary'; t: number; duration: number }
  | { kind: 'bigWin'; t: number; duration: number; hold: number }
  | { kind: 'cycle'; t: number; index: number };

/**
 * Win presentation: line/ways highlights, symbol pulse, dim of non-winners, big-win count-up.
 * `present()` resolves after the summary (+ big win). The per-win cycle then loops until `clear()`.
 */
export class WinPresenter {
  readonly view = new Container();
  private readonly lines = new Graphics();
  private readonly overlay = new Container();
  private readonly shade = new Graphics();
  private readonly title: Text;
  private readonly amount: Text;
  private phase: Phase = { kind: 'idle' };
  private wins: readonly Win[] = [];
  private presentation: WinPresentation | null = null;
  private resolve: (() => void) | null = null;
  private pulseT = 0;
  private geo: GridGeometry | null = null;

  constructor(
    private config: GameConfig,
    private readonly reels: () => readonly Reel[],
    private readonly particles: ParticleBurst | null,
    private readonly formatMoney: (minor: number) => string,
    private readonly reducedMotion: boolean,
  ) {
    this.title = new Text({ text: '', style: { fontFamily: config.theme.fontDisplay, fontWeight: '900', fontSize: 64, fill: 0xffffff }, anchor: 0.5 });
    this.amount = new Text({ text: '', style: { fontFamily: config.theme.fontDisplay, fontWeight: '800', fontSize: 48, fill: 0xffffff }, anchor: 0.5 });
    this.overlay.addChild(this.shade, this.title, this.amount);
    this.overlay.visible = false;
    this.view.addChild(this.lines, this.overlay);
    this.applyTheme(config);
  }

  applyTheme(config: GameConfig): void {
    this.config = config;
    const t = config.theme;
    this.title.style.fontFamily = t.fontDisplay;
    this.title.style.fill = hex(t.win);
    this.title.style.stroke = { color: hex(t.background), width: 8, join: 'round' };
    this.title.style.dropShadow = { color: hex(t.glow), blur: 24, distance: 0, alpha: 1, angle: 0 };
    this.amount.style.fontFamily = t.fontDisplay;
    this.amount.style.fill = 0xffffff;
    this.amount.style.dropShadow = { color: hex(t.win), blur: 16, distance: 0, alpha: 1, angle: 0 };
  }

  layout(geo: GridGeometry): void {
    this.geo = geo;
    const s = Math.max(0.5, Math.min(1.4, geo.width / 720));
    this.title.style.fontSize = Math.round(64 * s);
    this.amount.style.fontSize = Math.round(48 * s);
    this.title.position.set(geo.stageW / 2, geo.originY + geo.height * 0.42);
    this.amount.position.set(geo.stageW / 2, geo.originY + geo.height * 0.42 + 70 * s);
    this.shade.clear().rect(0, 0, geo.stageW, geo.stageH).fill({ color: 0x000000, alpha: 0.55 });
    this.redrawLines();
  }

  present(p: WinPresentation): Promise<void> {
    this.finish();
    this.presentation = p;
    this.wins = p.wins;
    const summary = (p.turbo ? 700 : 1300) * (this.reducedMotion ? 0.6 : 1);
    this.phase = { kind: 'summary', t: 0, duration: summary };
    this.redrawLines();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  skip(): void {
    const ph = this.phase;
    if (ph.kind === 'summary') this.afterSummary();
    else if (ph.kind === 'bigWin') {
      ph.t = ph.duration; // jump the counter to the final amount
      ph.hold = Math.min(ph.hold, 250);
    }
  }

  /** Remove all highlights (next spin starts). */
  clear(): void {
    this.finish();
    this.wins = [];
    this.presentation = null;
    this.phase = { kind: 'idle' };
    this.lines.clear();
    this.overlay.visible = false;
    this.particles?.clear();
    for (const r of this.reels()) r.setHighlight(null, false, 0);
  }

  get presenting(): boolean {
    return this.phase.kind !== 'idle';
  }

  update(dtMs: number): void {
    const ph = this.phase;
    if (ph.kind === 'idle') return;
    this.pulseT += dtMs;
    const pulse = this.reducedMotion ? 0 : 0.5 + 0.5 * Math.sin((this.pulseT / 1000) * Math.PI * 2 * 1.5);

    if (ph.kind === 'summary') {
      ph.t += dtMs;
      this.highlight(this.allPositions(), true, pulse);
      if (ph.t >= ph.duration) this.afterSummary();
    } else if (ph.kind === 'bigWin') {
      ph.t += dtMs;
      const u = Math.min(1, ph.t / ph.duration);
      const total = this.presentation?.totalWin ?? 0;
      this.amount.text = this.formatMoney(Math.round(total * easeOutCubic(u)));
      const pop = this.reducedMotion ? 1 : 1 + 0.06 * Math.sin(ph.t / 70) * (1 - u);
      this.title.scale.set(pop * (0.8 + 0.2 * easeOutCubic(Math.min(1, ph.t / 300))));
      this.highlight(this.allPositions(), true, pulse);
      if (u >= 1) {
        this.particles?.stop();
        ph.hold -= dtMs;
        if (ph.hold <= 0) {
          this.overlay.visible = false;
          this.startCycle();
          this.finish();
        }
      }
    } else {
      ph.t += dtMs;
      const win = this.wins[ph.index];
      this.highlight(win ? win.positions : [], true, pulse);
      if (ph.t >= 1100) {
        ph.t = 0;
        ph.index = (ph.index + 1) % Math.max(1, this.wins.length);
        this.redrawLines(ph.index);
      }
    }
  }

  private afterSummary(): void {
    const p = this.presentation;
    const label = p ? TIER_LABEL[p.tier] : undefined;
    const duration = p ? TIER_MS[p.tier] : undefined;
    if (p && label && duration) {
      const scale = (p.turbo ? 0.5 : 1) * (this.reducedMotion ? 0.5 : 1);
      this.phase = { kind: 'bigWin', t: 0, duration: duration * scale, hold: 700 * scale };
      this.title.text = label;
      this.amount.text = this.formatMoney(0);
      this.overlay.visible = true;
      if (this.particles && this.geo && !this.reducedMotion) {
        const colors = [this.config.theme.win, this.config.theme.glow, this.config.theme.frame].map(hex);
        this.particles.emit(this.geo.stageW / 2, this.geo.originY + this.geo.height * 0.75, duration * scale * 0.85, colors);
      }
      return;
    }
    this.startCycle();
    this.finish();
  }

  private startCycle(): void {
    if (this.wins.length > 1) {
      this.phase = { kind: 'cycle', t: 0, index: 0 };
      this.redrawLines(0);
    } else {
      // Single win: keep it highlighted until the next spin.
      this.phase = { kind: 'cycle', t: -Infinity, index: 0 };
      this.redrawLines();
    }
  }

  private finish(): void {
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  private allPositions(): Position[] {
    return this.wins.flatMap((w) => w.positions);
  }

  private highlight(positions: readonly Position[], dim: boolean, pulse: number): void {
    const byReel = new Map<number, Set<number>>();
    for (const p of positions) {
      let set = byReel.get(p.reel);
      if (!set) byReel.set(p.reel, (set = new Set()));
      set.add(p.row);
    }
    for (const reel of this.reels()) reel.setHighlight(byReel.get(reel.index) ?? new Set(), dim, pulse);
  }

  private redrawLines(only?: number): void {
    const g = this.lines;
    g.clear();
    const geo = this.geo;
    if (!geo || this.wins.length === 0) return;
    const colors = this.config.theme.lineColors.map(hex);
    const center = (p: Position) => ({ x: geo.originX + (p.reel + 0.5) * geo.cellW, y: geo.originY + (p.row + 0.5) * geo.cellH });
    const list = only === undefined ? this.wins : this.wins.slice(only, only + 1);

    list.forEach((win, i) => {
      const color = colors[(win.lineIndex ?? i) % colors.length] ?? 0xffffff;
      if (win.kind === 'line' && win.lineIndex !== null && this.config.evaluation.kind === 'lines') {
        const rows = this.config.evaluation.lines[win.lineIndex] ?? [];
        const pts = rows.map((row, reel) => center({ reel, row }));
        const first = pts[0];
        if (!first) return;
        // Glow pass, then core pass.
        for (const [width, alpha] of [
          [14, 0.22],
          [4, 1],
        ] as const) {
          g.moveTo(first.x - geo.cellW * 0.45, first.y);
          for (const pt of pts) g.lineTo(pt.x, pt.y);
          const last = pts[pts.length - 1] ?? first;
          g.lineTo(last.x + geo.cellW * 0.45, last.y);
          g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
        }
      }
      // Boxes around winning cells (all kinds).
      for (const p of win.positions) {
        const inset = 6;
        g.roundRect(geo.originX + p.reel * geo.cellW + inset, geo.originY + p.row * geo.cellH + inset, geo.cellW - inset * 2, geo.cellH - inset * 2, 14).stroke({
          width: 3,
          color,
          alpha: 0.9,
        });
      }
    });
  }
}
