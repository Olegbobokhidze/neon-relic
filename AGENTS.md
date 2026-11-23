# AGENTS.md — Operating Guide for AI Coding Agents

This file is the contract for any AI agent (or human) changing this repository.
Read it fully before your first edit in a session.

---

## 1. Before you edit anything

1. **Read the decisions.** Skim every file in [`docs/decisions/`](docs/decisions/) (ADRs). They are short.
   An `Accepted` ADR is binding. Do not work against it silently. To change direction, write a
   new ADR that supersedes it (see §5).
2. **Read the recent log.** `tail -n 20 docs/ai/decision-log.jsonl` shows the latest decisions,
   newest last.
3. **Read the latest session report.** `ls docs/ai/reports/ | sort | tail -n 2`. Its
   *Known limitations* and *Next steps* sections are your backlog.
4. **Run the baseline.** `pnpm verify` must pass before you start. If it fails, say so in your
   report and fix it, or flag it, before you do new work.

## 2. Directory boundaries

| Path | Owns | May import | Must NOT import |
|---|---|---|---|
| `packages/engine` | Config types, RNG, evaluator, outcome generation, spin state machine, controller | nothing (dependency root) | React, Pixi, DOM globals, any `@slot/*` |
| `packages/adapters` | `OutcomeProvider` implementations (mock, HTTP) | `@slot/engine` | React, Pixi |
| `packages/themes` | `GameConfig` objects + registry | `@slot/engine` (types) | React, Pixi |
| `packages/renderer-pixi` | Reels, symbols, FX, frame stats; implements `ReelsPort` | `@slot/engine`, `pixi.js` | React |
| `packages/audio` | `SoundManager`, controller → audio binding | `@slot/engine` (types) | React, Pixi |
| `apps/web` | Composition root, React HUD, drawers, inspector | everything above | — |

Data flows one way: **config → engine (controller) → ports (renderer, audio) → UI subscribes to snapshots.**
The UI never drives reels directly. It only sends intents (`spin`, `setBet`, …) to the controller.

ESLint enforces these boundaries (`eslint.config.js`). Do not disable these rules. Change the
architecture through an ADR instead.

## 3. Coding conventions

- **TypeScript strict** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **No `enum`, no `interface`.** Use:
  ```ts
  export const SpinState = { IDLE: 'IDLE', SPINNING: 'SPINNING' } as const;
  export type SpinState = (typeof SpinState)[keyof typeof SpinState];
  export type Outcome = { grid: Grid; totalWin: number };
  ```
- Prefer discriminated unions (`{ ok: true, … } | { ok: false, … }`) over thrown errors across
  module boundaries.
- Engine code is **pure and deterministic**: inject time, randomness and async effects through ports.
  Never call `Math.random()` or `Date.now()` directly in `packages/engine`. Use the injected `Rng`
  and `Clock`.
- Money is held as **integer minor units** (cents). Format only at the UI edge.
- CSS: use even, integer-pixel `line-height` values (16/20/24/28/32) from the tokens in
  `apps/web/src/styles/tokens.css`. Primary actions in modals and drawers are **right-aligned**.
- Every new engine behaviour gets a Vitest test next to it (`*.test.ts`).
- Commits: imperative subject, ≤72 chars, scoped prefix (`engine:`, `renderer:`, `web:`, `docs:`, …).

## 4. Recording decisions (every meaningful choice)

A *meaningful* choice is one that a future engineer could reasonably have made differently:
a library, a data shape, a state transition, a public API, a perf trade-off, a UX convention.

Append one JSONL line to `docs/ai/decision-log.jsonl`. Use the helper so the schema and timestamp
are always correct:

```bash
pnpm log:decision -- \
  --actor agent \
  --area engine/state-machine \
  --decision "Reject SPIN while not IDLE instead of queueing it" \
  --rationale "Queued spins cause surprise bets; rejecting is idempotent and auditable" \
  --files packages/engine/src/state-machine.ts,packages/engine/src/state-machine.test.ts \
  --tradeoffs "Rapid tappers must tap again after the round ends"
```

Schema (all fields required, `timestamp` is ISO-8601 UTC and set by the script):

```json
{"timestamp":"2026-11-23T17:00:00Z","actor":"agent","area":"engine/state-machine","decision":"…","rationale":"…","filesTouched":["…"],"tradeoffs":"…"}
```

The log is **append-only**. Never rewrite or delete earlier lines. If a decision is reversed,
append a new entry that says so.

## 5. When to write an ADR instead

Write an ADR (`docs/decisions/ADR-XXXX-kebab-title.md`, copied from `ADR-TEMPLATE.md`, using the
next free number) when the decision:
- changes a module boundary or a cross-package contract (`ReelsPort`, `OutcomeProvider`, `GameConfig`),
- adds or removes a runtime dependency, or
- reverses or supersedes an existing ADR. In that case, set the old ADR's status to
  `Superseded by ADR-XXXX`. This is the only edit allowed to an accepted ADR.

Also add a log entry that points to the new ADR.

## 6. End-of-session report (mandatory)

Before you finish a session:

```bash
pnpm report:new -- <short-slug>   # creates docs/ai/reports/YYYY-MM-DD-<short-slug>.md
```

Fill in every section of the template: summary, completed work, key decisions (with timestamps and
links to the ADRs and log entries), **verification with the actual command output**, known
limitations, and next steps. Do not claim a check passed unless you ran it in this session.

## 7. Verification commands

```bash
pnpm install
pnpm typecheck   # tsc --noEmit in every package
pnpm lint        # ESLint, including the architecture rules
pnpm test        # Vitest (engine, adapters, themes, renderer math)
pnpm build       # Vite production build of apps/web
pnpm verify      # all of the above, in order
pnpm dev         # http://localhost:5173 — press ` (backtick) for the Inspector
```
