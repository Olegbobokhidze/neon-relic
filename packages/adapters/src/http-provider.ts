import { ProviderErrorCode, type OutcomeProvider, type SpinRequest, type SpinResponse } from '@slot/engine';
import { parseSpinResponse } from './validate';

export type HttpProviderOptions = {
  /** e.g. https://rgs.example.com/api/v1/games */
  readonly baseUrl: string;
  readonly sessionToken: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Reference adapter for a real remote game server. Expects:
 *   POST {baseUrl}/spin    body: SpinRequest  → SpinResponse
 *   GET  {baseUrl}/balance                    → { balance: number }
 * Never throws: every transport or shape failure becomes `{ ok: false }`.
 */
export class HttpProvider implements OutcomeProvider {
  readonly id = 'http';
  private readonly opts: Required<Omit<HttpProviderOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(options: HttpProviderOptions) {
    this.opts = {
      baseUrl: options.baseUrl.replace(/\/$/, ''),
      sessionToken: options.sessionToken,
      timeoutMs: options.timeoutMs ?? 6000,
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    };
  }

  async spin(req: SpinRequest): Promise<SpinResponse> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await this.opts.fetchImpl(`${this.opts.baseUrl}/spin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.sessionToken}` },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (!res.ok) {
        const code = res.status === 402 ? ProviderErrorCode.INSUFFICIENT_FUNDS : ProviderErrorCode.SERVER;
        return { ok: false, spinId: req.spinId, error: { code, message: `HTTP ${res.status}`, recoverable: res.status < 500 || res.status === 503 } };
      }
      const parsed = parseSpinResponse(await res.json(), req.spinId);
      if (!parsed.ok) {
        return { ok: false, spinId: req.spinId, error: { code: ProviderErrorCode.VALIDATION, message: parsed.error, recoverable: true } };
      }
      return parsed.value;
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      return {
        ok: false,
        spinId: req.spinId,
        error: {
          code: aborted ? ProviderErrorCode.TIMEOUT : ProviderErrorCode.NETWORK,
          message: aborted ? `No response within ${this.opts.timeoutMs}ms` : String(err),
          recoverable: true,
        },
      };
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  async getBalance(): Promise<number> {
    const res = await this.opts.fetchImpl(`${this.opts.baseUrl}/balance`, {
      headers: { authorization: `Bearer ${this.opts.sessionToken}` },
    });
    const json: unknown = await res.json();
    if (typeof json === 'object' && json !== null && 'balance' in json && typeof json.balance === 'number') return json.balance;
    throw new Error('Malformed balance response');
  }
}
