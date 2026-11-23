# ADR-0002: Render reels with PixiJS v8 and a single delta-time ticker

- **Date:** 2026-11-23T17:02:35Z
- **Status:** Accepted
- **Deciders:** human (project owner), agent (Claude)
- **Related:** ADR-0001, ADR-0005

## Context

Reels must scroll at a steady 60fps on mid-range phones, with blur-like motion, glow, line
highlights and particles. DOM or CSS animation of many symbol nodes risks layout thrashing and
can't be frame-synchronised with game logic. The studios we are targeting mostly use WebGL
renderers, PixiJS in particular.

## Decision

- `@slot/renderer-pixi` uses **PixiJS v8** (WebGL, WebGPU-ready).
- A **single `app.ticker` callback** advances every reel with `deltaMS`. Reel motion is a pure
  function of elapsed time (`reel-math.ts`): accelerate → cruise → decelerate with an overshoot
  ease, so it is frame-rate independent and unit-testable.
- **Symbols are generated procedurally** (Graphics + Text) from theme config and baked once to
  textures (`renderer.generateTexture`). There are no binary art assets, a skin swap is a config
  swap, and there is nothing to fail to load.
- The ticker never touches React. The UI polls `FrameStats` at 4Hz for the inspector.
- Each reel is a masked container with `rows + 2` pooled sprites that wrap around (object pooling,
  no per-frame allocation).

## Alternatives Considered

1. **Raw Canvas 2D.** No dependency, but glow and filters cost a lot on the CPU, and HiDPI handling
   is hand-written.
2. **DOM + CSS transforms.** Easy to style, but costs many compositor layers, makes frame
   timing hard to control, and makes per-pixel FX hard.
3. **Three.js.** Overkill for 2D. It pulls in a scene graph we would mostly ignore.

## Trade-offs

| We gain | We give up |
|---|---|
| GPU batching, filters, crisp HiDPI | About 200KB of gzipped dependency |
| Industry-familiar stack for reviewers | WebGL context-loss handling becomes our concern |
| Procedural art means instant skin swaps | Less illustrative than hand-painted sprites |

## Consequences

- Real art can replace procedural symbols later by mapping `symbol.id` → texture URL in the
  theme. The `ReelsPort` contract does not change.
