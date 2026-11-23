# ADR-0003: Explicit, table-driven spin state machine

- **Date:** 2026-11-23T17:02:35Z
- **Status:** Accepted
- **Deciders:** human (project owner), agent (Claude)
- **Related:** ADR-0001, ADR-0004

## Context

Slot clients fail in production because of implicit state: double-spins from rapid taps, stale
server responses applied to the wrong round, auto-spin that keeps running after an error, and
turbo toggles mid-round. Regulators and QA also need to know exactly which state the
client was in at any moment.

## Decision

States are a `const` object plus a union type:

`IDLE → SPIN_REQUESTED → SPINNING → STOPPING → EVALUATING → (WIN_PRESENTATION) → (BONUS_OR_FREE_SPINS) → IDLE`,
with `ERROR_RECOVERABLE` reachable from `SPIN_REQUESTED`/`SPINNING`.

- A pure reducer `transition(ctx, event) → { ctx, effects, accepted }` uses an **allowed-transition
  table** (`TRANSITIONS[state][event.type]`). Events not allowed in the current state are
  **rejected and recorded** (never thrown), so a double-tap is a no-op you can see in the log.
- Side effects (call the provider, start reels, present wins) are returned as **effect
  descriptors**. `SlotController` interprets them, so the reducer stays deterministic.
- Each round gets a monotonic `spinId`. A provider response whose `spinId` doesn't match the
  current round is discarded (stale-response guard).
- The bet is debited optimistically on `SPIN_REQUESTED` and refunded on error, so the balance
  shown is always what the player can actually spend.
- Turbo is a context flag read when effects are produced. Toggling mid-spin affects the next
  round only. Auto-spin is a counter decremented on `ROUND_COMPLETE` that stops on error, on
  insufficient funds, or (optionally) on a win.
- Every accepted or rejected transition is emitted with a timestamp from the injected `Clock`
  for the inspector.

## Alternatives Considered

1. **Boolean flags (`isSpinning`, `isPresenting`).** The usual source of impossible states.
2. **XState.** Excellent, but an extra dependency and DSL. The table here is about 40 lines.
3. **Queue spin requests while busy.** Surprises players with extra bets. Rejected.

## Trade-offs

| We gain | We give up |
|---|---|
| Impossible states can't be represented | New states need table and test updates |
| Replay or inspection of every transition | Slightly more ceremony than flags |

## Consequences

- The inspector can render the live state and the transition history directly from controller events.
