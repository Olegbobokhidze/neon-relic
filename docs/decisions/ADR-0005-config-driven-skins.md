# ADR-0005: One `GameConfig` object drives maths, layout and skin

- **Date:** 2026-11-23T17:02:35Z
- **Status:** Accepted
- **Deciders:** human (project owner), agent (Claude)
- **Related:** ADR-0002, ADR-0004

## Context

A provider shell must host many titles. Reel count, rows, paylines vs ways, symbol weights,
paytable, bet ladder and visual theme all vary per title.

## Decision

`GameConfig` (type in `@slot/engine`, data in `@slot/themes`) is the single source of truth:

- `layout`: `{ reels, rows }`
- `symbols[]`: `{ id, name, kind: 'regular'|'wild'|'scatter', weight, pays: { 3?, 4?, 5? }, art: { glyph, color, accent } }`
- `evaluation`: `{ kind: 'lines', lines: number[][] } | { kind: 'ways' }`
- `freeSpins`: `{ scatterCount, awarded, multiplier }`
- `bet`: `{ presets: number[], defaultIndex }` (minor units)
- `theme`: color tokens consumed by both Pixi (background, frame, glow) and CSS custom properties.

`validateConfig()` checks invariants at load time: line length equals reel count, row indices are
in range, at least one regular symbol, weights > 0, and so on. An invalid config fails fast with
readable errors.

The paytable UI, reel layout, symbol textures and evaluator all derive from the config, so
switching titles is `controller.loadConfig(next)` plus `stage.rebuild(next)`.

## Alternatives Considered

1. **Per-title code modules.** Flexible, but they drift apart and duplicate logic.
2. **JSON files fetched at runtime.** Good for production. Kept as a later option: the type plus
   `validateConfig` already supports it.

## Trade-offs

| We gain | We give up |
|---|---|
| A new title is mostly data | Exotic mechanics (cascades, expanding reels) need engine extension points |
| Paytable is always in sync with the maths | Config type grows over time |

## Consequences

- Two configs ship: `neon-relic` (5×3, 20 lines) and `crystal-ways` (5×4, 1024 ways). They prove the abstraction.
