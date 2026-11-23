import { Container, Sprite, type Texture } from 'pixi.js';

type Particle = { sprite: Sprite; vx: number; vy: number; life: number; maxLife: number; spin: number };

/** Pooled additive particles. Fixed capacity, so there's no GC churn during a big win. */
export class ParticleBurst {
  readonly view = new Container();
  private readonly pool: Particle[] = [];
  private active = 0;
  private emitting = 0;
  private emitX = 0;
  private emitY = 0;
  private colors: readonly number[] = [0xffd23f];

  constructor(texture: Texture, capacity = 160) {
    for (let i = 0; i < capacity; i++) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      sprite.visible = false;
      this.view.addChild(sprite);
      this.pool.push({ sprite, vx: 0, vy: 0, life: 0, maxLife: 1, spin: 0 });
    }
  }

  /** Emit continuously for `ms` from (x, y). */
  emit(x: number, y: number, ms: number, colors: readonly number[]): void {
    this.emitX = x;
    this.emitY = y;
    this.emitting = ms;
    this.colors = colors.length ? colors : this.colors;
  }

  stop(): void {
    this.emitting = 0;
  }

  get busy(): boolean {
    return this.active > 0 || this.emitting > 0;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    if (this.emitting > 0) {
      this.emitting -= dtMs;
      const spawn = Math.ceil(dtMs * 0.35);
      for (let i = 0; i < spawn; i++) this.spawn();
    }
    let alive = 0;
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      alive++;
      p.vy += 900 * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.rotation += p.spin * dt;
      p.sprite.alpha = Math.min(1, (p.life / p.maxLife) * 1.6);
    }
    this.active = alive;
  }

  private spawn(): void {
    const p = this.pool.find((q) => q.life <= 0);
    if (!p) return;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 380 + Math.random() * 520;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.maxLife = p.life = 1.1 + Math.random() * 0.9;
    p.spin = (Math.random() - 0.5) * 8;
    p.sprite.position.set(this.emitX + (Math.random() - 0.5) * 60, this.emitY);
    p.sprite.scale.set(0.5 + Math.random() * 0.9);
    p.sprite.tint = this.colors[Math.floor(Math.random() * this.colors.length)] ?? 0xffffff;
    p.sprite.visible = true;
  }

  clear(): void {
    this.emitting = 0;
    for (const p of this.pool) {
      p.life = 0;
      p.sprite.visible = false;
    }
    this.active = 0;
  }
}
