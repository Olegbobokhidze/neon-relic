import { BlurFilter, Container, Graphics, Rectangle, Text, type Renderer, type Texture } from 'pixi.js';
import type { GameConfig, SymbolArt, SymbolDef } from '@slot/engine';

/** Texture edge length in CSS px; baked at device resolution for crispness. */
export const SYMBOL_TEXTURE_SIZE = 200;

const SYMBOL_FONT = "system-ui, 'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Apple Symbols', sans-serif";

function shapePath(g: Graphics, art: SymbolArt, cx: number, cy: number, r: number): Graphics {
  switch (art.shape) {
    case 'orb':
      return g.circle(cx, cy, r);
    case 'hex':
      return g.regularPoly(cx, cy, r, 6, Math.PI / 6);
    case 'diamond':
      return g.poly([cx, cy - r, cx + r * 0.82, cy, cx, cy + r, cx - r * 0.82, cy]);
    case 'star':
      return g.star(cx, cy, 5, r, r * 0.5, 0);
    case 'gem': {
      const t = r * 0.42;
      return g.poly([cx - t, cy - r * 0.8, cx + t, cy - r * 0.8, cx + r, cy - r * 0.15, cx, cy + r, cx - r, cy - r * 0.15]);
    }
    case 'rune':
      return g.regularPoly(cx, cy, r, 8, Math.PI / 8);
    case 'card':
      return g.roundRect(cx - r * 0.78, cy - r, r * 1.56, r * 2, r * 0.22);
  }
}

function buildSymbol(sym: SymbolDef, config: GameConfig): Container {
  const S = SYMBOL_TEXTURE_SIZE;
  const c = S / 2;
  const r = S * 0.36;
  const root = new Container();
  const { art } = sym;
  const isHero = sym.kind !== 'regular';
  const isCard = art.shape === 'card';

  // Outer glow: a blurred, thick stroke of the shape.
  const glow = shapePath(new Graphics(), art, c, c, r).stroke({ width: isHero ? 18 : 12, color: art.color, alpha: isHero ? 0.75 : 0.5 });
  glow.filters = [new BlurFilter({ strength: isHero ? 14 : 10, quality: 4 })];
  root.addChild(glow);

  // Body.
  const body = shapePath(new Graphics(), art, c, c, r)
    .fill({ color: isCard ? art.accent : config.theme.reelBackground, alpha: 1 })
    .stroke({ width: 5, color: art.color, alignment: 0.5, join: 'round' });
  root.addChild(body);

  // Inner facet / highlight.
  if (!isCard) {
    const inner = shapePath(new Graphics(), art, c, c, r * 0.72).fill({ color: art.color, alpha: 0.18 }).stroke({ width: 2, color: art.accent, alpha: 0.7 });
    root.addChild(inner);
  }
  const shine = new Graphics().ellipse(c - r * 0.25, c - r * 0.45, r * 0.42, r * 0.16).fill({ color: 0xffffff, alpha: 0.12 });
  root.addChild(shine);

  // Glyph.
  const isLetter = /^[A-Z0-9]{1,2}$/.test(art.glyph);
  const glyph = new Text({
    text: art.glyph,
    style: {
      fontFamily: isLetter ? config.theme.fontDisplay : SYMBOL_FONT,
      fontWeight: '900',
      fontSize: isLetter ? (isCard ? S * 0.42 : S * 0.3) : S * 0.32,
      fill: isCard ? art.color : art.accent,
      stroke: { color: isCard ? art.accent : config.theme.reelBackground, width: 4, join: 'round' },
      dropShadow: { color: art.color, blur: 10, distance: 0, alpha: 0.9, angle: 0 },
      align: 'center',
    },
    anchor: 0.5,
  });
  glyph.position.set(c, c + (isLetter ? 2 : 4));
  root.addChild(glyph);

  if (isHero) {
    const label = new Text({
      text: sym.kind === 'wild' ? 'WILD' : 'SCATTER',
      style: {
        fontFamily: config.theme.fontDisplay,
        fontWeight: '800',
        fontSize: S * 0.085,
        letterSpacing: 2,
        fill: 0xffffff,
        dropShadow: { color: art.color, blur: 6, distance: 0, alpha: 1, angle: 0 },
      },
      anchor: 0.5,
    });
    label.position.set(c, S * 0.9);
    root.addChild(label);
  }
  return root;
}

export type SymbolTextures = {
  readonly get: (id: string) => Texture;
  readonly destroy: () => void;
};

/** Bake every symbol once; reels then only swap textures on pooled sprites. */
export function bakeSymbolTextures(renderer: Renderer, config: GameConfig): SymbolTextures {
  const S = SYMBOL_TEXTURE_SIZE;
  const map = new Map<string, Texture>();
  const resolution = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)) * 1.25;
  for (const sym of config.symbols) {
    const container = buildSymbol(sym, config);
    const texture = renderer.generateTexture({ target: container, frame: new Rectangle(0, 0, S, S), resolution, antialias: true });
    map.set(sym.id, texture);
    container.destroy({ children: true });
  }
  const fallback = map.values().next().value;
  if (!fallback) throw new Error('bakeSymbolTextures: config has no symbols');
  return {
    get: (id) => map.get(id) ?? fallback,
    destroy: () => {
      for (const t of map.values()) t.destroy(true);
      map.clear();
    },
  };
}

/** Small soft dot used by the particle system. */
export function bakeParticleTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(16, 16, 14).fill({ color: 0xffffff, alpha: 0.25 });
  g.circle(16, 16, 8).fill({ color: 0xffffff, alpha: 0.6 });
  g.circle(16, 16, 4).fill({ color: 0xffffff, alpha: 1 });
  const t = renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, 32, 32), resolution: 2 });
  g.destroy();
  return t;
}
