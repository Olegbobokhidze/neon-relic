# ADR-0004: Server-authoritative outcomes behind an `OutcomeProvider` port

- **Date:** 2026-11-23T17:02:35Z
- **Status:** Accepted
- **Deciders:** human (project owner), agent (Claude)
- **Related:** ADR-0001, ADR-0003

## Context

In real-money gaming the **server decides the outcome** and the client only presents it. A portfolio
demo has no server, but the client code must look exactly as it would against one, including
latency, failures and validation.

## Decision

The engine defines the port:

```ts
type OutcomeProvider = {
  readonly id: string;
  spin(req: SpinRequest): Promise<SpinResponse>;
};
type SpinResponse =
  | { ok: true; spinId: number; outcome: SpinOutcome }
  | { ok: false; spinId: number; error: { code: ProviderErrorCode; message: string; recoverable: boolean } };
```

- The client treats `outcome.grid`, `outcome.wins` and `outcome.totalWin` as authoritative. It
  **re-evaluates locally only to cross-check** (a mismatch is surfaced as a `VALIDATION` error).
- `MockProvider` (in `@slot/adapters`) runs `generateOutcome` from the engine with its own seeded RNG,
  plus configurable latency, an error rate, and **forced scenarios** (`bigWin`, `freeSpins`, `tease`,
  `networkError`, `insufficientFunds`) for demos and QA.
- `HttpProvider` shows how a real backend plugs in: `fetch` with a timeout through `AbortController`,
  then runtime validation of the response shape before it reaches the engine.
- Providers never throw across the port. Transport errors become `{ ok: false }`.

## Alternatives Considered

1. **Client-side RNG decides outcomes.** Unrealistic for the industry, and reviewers would notice.
2. **Throw on errors.** Mixes control flow with exceptions and makes recoverability implicit.

## Trade-offs

| We gain | We give up |
|---|---|
| A real backend drops in with no engine change | Mock duplicates "server" logic in the client bundle |
| Deterministic QA scenarios | Forced outcomes must stay valid for the config |

## Consequences

- Swapping `MockProvider` for `HttpProvider` is a one-line change in `apps/web/src/composition.ts`.
