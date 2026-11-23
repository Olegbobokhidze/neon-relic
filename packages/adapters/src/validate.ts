import type { SpinResponse } from '@slot/engine';

/**
 * Minimal runtime validation of an untrusted JSON payload before it reaches the engine.
 * (A production build might use zod/valibot; this keeps the package dependency-free.)
 */
export type ParseResult = { readonly ok: true; readonly value: SpinResponse } | { readonly ok: false; readonly error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function parseSpinResponse(json: unknown, expectedSpinId: number): ParseResult {
  if (!isObj(json)) return { ok: false, error: 'response is not an object' };
  if (json.spinId !== expectedSpinId) return { ok: false, error: `spinId ${String(json.spinId)} ≠ ${expectedSpinId}` };

  if (json.ok === false) {
    const err = json.error;
    if (!isObj(err) || typeof err.code !== 'string' || typeof err.message !== 'string') return { ok: false, error: 'malformed error' };
    return { ok: true, value: json as SpinResponse };
  }
  if (json.ok !== true) return { ok: false, error: '`ok` must be boolean' };
  if (!isInt(json.balanceAfter)) return { ok: false, error: 'balanceAfter must be an integer' };

  const o = json.outcome;
  if (!isObj(o)) return { ok: false, error: 'outcome missing' };
  if (!Array.isArray(o.grid) || !o.grid.every((col) => Array.isArray(col) && col.every((id) => typeof id === 'string'))) {
    return { ok: false, error: 'outcome.grid must be string[][]' };
  }
  if (!Array.isArray(o.wins)) return { ok: false, error: 'outcome.wins must be an array' };
  if (!isInt(o.totalWin) || !isInt(o.freeSpinsAwarded)) return { ok: false, error: 'outcome totals must be integers' };
  if (o.mode !== 'base' && o.mode !== 'free') return { ok: false, error: 'outcome.mode invalid' };
  return { ok: true, value: json as SpinResponse };
}
