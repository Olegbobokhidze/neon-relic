# ADR-0001: Separate a pure engine from rendering, audio and UI

- **Date:** 2026-11-23T17:02:35Z
- **Status:** Accepted
- **Deciders:** human (project owner), agent (Claude)
- **Related:** ADR-0003, ADR-0004, decision-log 2026-11-23T17:02:35Z

## Context

Game providers ship many titles on one shared client stack. Each title has different reel
layouts, maths, themes and backends. Logic that is welded to a UI framework or a renderer
can't be reused, can't be unit tested without a browser, and hides race conditions inside
component lifecycles.

## Decision

Use a pnpm monorepo with one-way dependencies:

```
@slot/engine  ←  @slot/adapters, @slot/themes, @slot/audio, @slot/renderer-pixi  ←  apps/web
```

- `@slot/engine` is pure TypeScript with zero runtime dependencies. It owns config types, the
  seeded RNG, win evaluation, outcome generation, the spin state machine and `SlotController`.
- The engine reaches the outside world only through **ports** (types): `OutcomeProvider`
  (backend), `ReelsPort` (renderer), `Clock`/`Rng`. Concrete implementations live in other packages.
- React exists only in `apps/web`. The UI reads engine state through
  `useSyncExternalStore(controller.subscribe, controller.getSnapshot)` and sends intents.
- ESLint `no-restricted-imports` / `no-restricted-globals` enforce the boundaries.

## Alternatives Considered

1. **Single app with folders.** Simpler, but the boundaries are a convention that nothing enforces.
   Reviewers can't see the separation at a glance.
2. **Redux/Zustand store as the engine.** Familiar to many developers, but it couples game logic
   to a UI state library and makes async effect ordering implicit.
3. **XState.** Gives a strong statechart model, but adds a dependency and a DSL. A hand-written
   reducer plus a transition table is small, explicit and easy to inspect at runtime (ADR-0003).

## Trade-offs

| We gain | We give up |
|---|---|
| Engine tests run in Node in milliseconds | Some workspace and tooling overhead |
| Renderer or UI can be swapped (Pixi → Canvas, React → Svelte) | Port types must be designed carefully up front |
| Deterministic replays from a seed + event list | Slight indirection when tracing a click to a reel |

## Consequences

- New titles are new `GameConfig` objects plus, optionally, a new renderer skin. The engine is untouched.
- Any feature that needs time or randomness must receive it through injected ports.
