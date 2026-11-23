# Neon Relic Slot

A modular, deterministic **slot game frontend**: a framework-free engine, a PixiJS v8 reel renderer,
a synthesized Web Audio layer, swappable backend adapters and a React HUD with a live **Provider Inspector**.
One engine runs different titles (5×3 paylines, 5×4 ways) by swapping a config object.

```bash
pnpm install
pnpm dev        # http://localhost:5173  ·  press ` for the Inspector  ·  Space to spin
```

## Architecture

```
            ┌──────────────── apps/web (composition root, React) ────────────────┐
            │  HUD · Paytable · Inspector ── useSyncExternalStore ──┐            │
            └───────────────────────────────────────────────────────┼────────────┘
                                                                    │ intents
 @slot/themes ──GameConfig──▶ @slot/engine  SlotController ◀────────┘
                               │ pure reducer: transition(config, ctx, event) → { ctx, effects }
                               ├── OutcomeProvider port ──▶ @slot/adapters   (MockProvider · HttpProvider)
                               ├── ReelsPort ─────────────▶ @slot/renderer-pixi (ReelStage)
                               └── events ────────────────▶ @slot/audio      (bindAudio → SoundManager)
```

| Package | Responsibility |
|---|---|
| [`packages/engine`](packages/engine/src) | Config types and validation, seeded RNG, lines and ways evaluation, outcome generation, **spin state machine**, controller, Monte-Carlo simulator. Zero dependencies, no DOM. |
| [`packages/adapters`](packages/adapters/src) | `MockProvider` (wallet, latency, error rate, forced scenarios) and `HttpProvider` (timeout and response validation). |
| [`packages/themes`](packages/themes/src) | `neon-relic` and `crystal-ways` configs: maths, layout, bet ladder, timing and theme tokens. |
| [`packages/renderer-pixi`](packages/renderer-pixi/src) | Delta-time reel motion, pooled sprites, tease, win lines, big-win FX, frame stats. |
| [`packages/audio`](packages/audio/src) | Synthesized SFX, persisted volume and mute, crash-proof fallback. |
| [`apps/web`](apps/web/src) | React UI and the wiring between packages. |

### Spin state machine

`IDLE → SPIN_REQUESTED → SPINNING → STOPPING → EVALUATING → WIN_PRESENTATION → BONUS_OR_FREE_SPINS → IDLE`,
with `ERROR_RECOVERABLE` on failures. Every state has an allow-list of events. Anything else is **rejected and
logged, never thrown**, so double-taps, stale responses (`spinId` guard) and out-of-order timers are harmless and visible
in the Inspector. See [ADR-0003](docs/decisions/ADR-0003-spin-state-machine.md).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server (`-- --host` to expose it on your LAN for phone testing) |
| `pnpm verify` | typecheck → lint (including architecture rules) → tests → production build |
| `pnpm test` | Vitest: engine, adapters, themes (with RTP gate), renderer maths, audio |
| `pnpm e2e` | Puppeteer smoke (25 checks) and responsive layout checks against a running dev server (`BASE_URL`, `CHROME_PATH`, `E2E_GPU=0`) |
| `pnpm log:decision -- …` | Append a timestamped entry to the decision log |
| `pnpm report:new -- <slug>` | Create a session report from the template |

URL params: `?inspector=1` · `?config=crystal-ways` · `?seed=123`

## Conventions

Strict TypeScript, **no `enum` / `interface`** (`as const` objects and `type` unions, enforced by ESLint), money in integer
minor units, even integer-pixel line heights, and right-aligned primary actions. See [AGENTS.md](AGENTS.md).

## Decision tracking

- [`docs/decisions/`](docs/decisions/): Architecture Decision Records (ADR-0001…0005, plus a template)
- [`docs/ai/decision-log.jsonl`](docs/ai/decision-log.jsonl): chronological, append-only decision log
- [`docs/ai/reports/`](docs/ai/reports/): per-session reports. Start with [2026-11-23-initial-build](docs/ai/reports/2026-11-23-initial-build.md)
- [`AGENTS.md`](AGENTS.md): operating guide for AI coding agents

## Swapping in a real backend

```ts
// apps/web/src/composition.ts
const provider = new HttpProvider({ baseUrl: 'https://rgs.example.com/api/v1/games', sessionToken });
```

The engine treats server outcomes as authoritative and cross-checks them locally (a mismatch becomes a `VALIDATION` error).
