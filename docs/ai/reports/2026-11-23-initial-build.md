# Session Report: initial-build

- **Date:** 2026-11-23
- **Started:** 2026-11-23T17:02:35Z (first commit scaffold; the report file itself was generated at 17:48:29Z)
- **Ended:** 2026-11-23T17:52:00Z
- **Actor(s):** human (project owner: requirements, renderer + repo-layout choices), agent (Claude Opus 5.5: implementation)
- **Branch / commits:** `main`, `4c3d33a..HEAD` (9 commits, including this report)

## 1. Summary

Built **Neon Relic Slot** from an empty folder. It is a pnpm monorepo with a framework-free, deterministic slot
engine, a PixiJS v8 reel renderer, a synthesized Web Audio layer, mock and HTTP backend adapters, two
config-driven titles, and a React HUD with a Provider Inspector. It also has a decision-tracking system
(ADRs, a JSONL decision log, session reports and AGENTS.md) so future human or AI sessions can trace every choice.

## 2. Completed Work

- [x] **Repo & conventions**: workspace, strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
      ESLint that **bans `enum`/`interface`** and enforces package boundaries ([eslint.config.js](../../../eslint.config.js)).
- [x] **Docs system**: [AGENTS.md](../../../AGENTS.md), [ADR-0001…0005](../../decisions/),
      [decision-log.jsonl](../decision-log.jsonl), [report template](./_TEMPLATE.md),
      `pnpm log:decision` / `pnpm report:new` helper scripts ([scripts/](../../../scripts/)).
- [x] **Engine** ([packages/engine](../../../packages/engine/src/)):
      table-driven spin state machine with all 8 states, effect descriptors, `spinId` stale guard,
      optimistic debit/refund, turbo, autoplay (count/∞, stop-on-win), free spins with retrigger and multiplier,
      client-side timeout, balance resync, lines and ways evaluation, scatter/tease/win tiers, seeded RNG, Monte-Carlo `simulate()`.
- [x] **Adapters** ([packages/adapters](../../../packages/adapters/src/)): `MockProvider` (own wallet and RNG, latency, error rate,
      9 forced scenarios including timeout and corrupt payload), `HttpProvider` reference implementation with runtime response validation.
- [x] **Themes** ([packages/themes](../../../packages/themes/src/)): `neon-relic` (5×3, 20 lines, ×2 free spins) and
      `crystal-ways` (5×4, 1024 ways, ×3 free spins), both tuned to about 95% estimated RTP.
- [x] **Renderer** ([packages/renderer-pixi](../../../packages/renderer-pixi/src/)): single delta-time ticker, pure
      `reel-math.ts` (wind-up → accel → cruise → velocity-continuous decel → overshoot/settle), virtual strip with pooled
      sprites, speed-scaled motion blur, staggered stops, scatter tease, procedural baked symbol textures, line/ways highlights,
      big/mega/epic count-up with pooled particles, `FrameStats` ring buffer.
- [x] **Audio** ([packages/audio](../../../packages/audio/src/)): synthesized SFX, lazy unlock, persisted volume and mute,
      pause on hidden tab, and every call is a no-op if Web Audio is blocked or missing.
- [x] **Web app** ([apps/web](../../../apps/web/src/)): HUD (balance, bet stepper, count-up win, turbo, autoplay, spin/slam),
      config-generated paytable with payline diagrams, error dialog, bonus banners, Provider Inspector, and responsive layouts.
- [x] **E2E**: [e2e/smoke.mjs](../../../e2e/smoke.mjs) (25 checks) and [e2e/layout.mjs](../../../e2e/layout.mjs) (6 viewports).

## 3. Key Decisions

Full rationale lives in the ADRs and in [decision-log.jsonl](../decision-log.jsonl) (21 entries).

| Timestamp (UTC) | Area | Decision | Reference |
|---|---|---|---|
| 2026-11-23T17:02:35Z | repo | pnpm monorepo; PixiJS v8 (human choice) | ADR-0001, ADR-0002 |
| 2026-11-23T17:02:35Z | engine | Table-driven reducer + effects + `spinId` guard | ADR-0003 |
| 2026-11-23T17:02:35Z | adapters | Server-authoritative `OutcomeProvider`; client cross-check | ADR-0004 |
| 2026-11-23T17:02:35Z | config | One validated `GameConfig` drives maths, layout and skin | ADR-0005 |
| 2026-11-23T17:17:15Z | maths | Tune to about 95% RTP and gate configs with a CI simulation (85–105%) | log |
| 2026-11-23T17:17:16Z | controller | 8s client timeout; late responses rejected; balance resync on recover | log |
| 2026-11-23T17:21:50Z | renderer | Virtual strip; stop target planned ≥ rows+1 ahead (no symbol pop) | log |
| 2026-11-23T17:46:04Z | renderer | Ignore context loss after destroy (StrictMode false alarm); dt cap 100ms | log |
| 2026-11-23T17:46:05Z | web | Engine created outside React; `useSyncExternalStore` bridge | log |
| 2026-11-23T17:46:06Z | testing | Puppeteer e2e on hardware GPU; SwiftShader fallback skips FPS assertion | log |
| 2026-11-23T17:46:33Z | controller | Primary button always stops autoplay first (bug found in review) | log |

## 4. Verification

All commands below were run in this session, after the final code change (commit `4eeb447`).

| Check | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | ✅ 6 packages, 0 errors |
| Lint | `pnpm lint` | ✅ 0 problems. Rules were also checked to *fire* on a sample with `enum`, `interface`, `window` and a `react` import in the engine (5 errors reported) |
| Tests | `pnpm test` | ✅ 7 files, **64 tests** passed. Sim: neon-relic RTP 95.12%, hit 41.4%, feature 1/54 · crystal-ways RTP 94.53%, hit 67.0%, feature 1/57 |
| Build | `pnpm build` | ✅ app 28.7 KB gz · react 45.5 KB gz · pixi 167.3 KB gz (separate chunk) |
| E2E smoke | `pnpm e2e` (dev server, headless Chrome, Intel Xe iGPU) | ✅ **25/25**: spin, no double-spin under Space spam, big win, free spins (state + banner + full feature), network error → refund → recover, corrupt payload → `VALIDATION`, config swap to crystal-ways, **59 fps during spin (p95 16.8 ms)**, right-aligned modal and drawer actions, no page errors |
| Layout | `node e2e/layout.mjs` | ✅ no overlap or overflow at 320, 360, 390 portrait · 844×390 landscape · 820 tablet · 1280 desktop |

Notes on verification honesty:
- In headless SwiftShader (software GL) the stage renders at about 5 fps. Perf numbers above are from the hardware-GPU run.
- One e2e run (right after a `pnpm install`) reported 23/25. I did not capture which checks failed. Every other run on the
  final harness (2 before it, 5 after it) was 25/25, and the Vite log shows no reload. Treat it as a possible flake to watch.
- Audio was verified only through unit tests (fallback, persistence, clamping). Nobody listened to it in this session.

## 5. Known Limitations

- **Maths is a demo model**: per-cell weighted symbols, not reel strips. RTP is a Monte-Carlo estimate (about ±2%), not certified.
- **Free-spin state is client-tracked**: the mock trusts `mode: 'free'`. A real RGS must own feature state and resume.
- **No session resume / round replay** after reload mid-round. A timed-out round relies on balance resync only.
- **WebGL context loss** shows a reload prompt. It doesn't restore the GPU state automatically.
- **Inspector ships in production builds**. Gate it behind a build flag or URL token for operator deployments.
- **Slam-stop during deceleration snaps** the remaining distance (a deliberate "thunk"). Some studios prefer an accelerated ease.
- Free-spin trigger win is not included in the "Feature win" meter (shown on its own before the feature starts).
- E2E needs a local Chrome and a running dev server, and isn't wired into CI yet.

## 6. Next Steps

1. CI workflow: `pnpm verify` on every push. Run e2e with `E2E_GPU=0` (functional checks only).
2. Reel-strip maths model plus a certification-style simulation report (volatility index, hit-frequency per symbol).
3. Session resume: `OutcomeProvider.restore()` and an engine `RESUME_ROUND` event.
4. Build-time flag for the Inspector; a URL `?provider=http&url=…` switch to `HttpProvider`.
5. Hand-authored art pipeline (texture atlas per theme) behind the same `SymbolArt` contract.
6. Accessibility pass: live-region announcements for wins and reduced-motion audit of the Pixi FX.

## How to run & demo

```bash
pnpm install
pnpm dev              # http://localhost:5173  (add `-- --host` to test on a phone over LAN)
```

Demo script (about 2 minutes):
1. Press **Space** to spin. Mash Space: the extra presses become slam-stops and never double-spin.
2. Press **`** to open the Provider Inspector. Watch the state chain and the transition log.
3. *Force next outcome → Big win*, then spin: line highlight and big-win count-up with particles.
4. *Force → Trigger free spins*: banner, `BONUS_OR_FREE_SPINS`, ×2 wins, feature summary.
5. *Force → Network error* or *Timeout*: error dialog, stake refunded, **Continue** recovers. *Corrupt payload* shows the client integrity check.
6. Switch *Active title → Crystal Ways* while idle: 5×4 ways layout and a new skin, with the same engine.
7. Click *Simulate 20k spins* for an in-browser RTP estimate, and turn on **Turbo** / **Auto** with stop-on-win.

URL params: `?inspector=1`, `?config=crystal-ways`, `?seed=123`.
