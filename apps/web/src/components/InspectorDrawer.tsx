import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ForcedScenario, SCENARIO_LABELS } from '@slot/adapters';
import { simulate, SPIN_STATE_ORDER, SpinState, type SimulationReport, type SpinResponse, type TransitionRecord } from '@slot/engine';
import type { FrameStatsSnapshot } from '@slot/renderer-pixi';
import { GAME_CONFIGS, getConfig } from '@slot/themes';
import { useControllerEvent, useGame, useMockSettings, useMockWallet, useSlot } from '../hooks/game';
import { Drawer } from './Drawer';

type Props = { readonly open: boolean; readonly onClose: () => void };

export function InspectorDrawer({ open, onClose }: Props) {
  const { controller } = useGame();
  const [history, setHistory] = useState<readonly TransitionRecord[]>(() => controller.getHistory());
  const [lastResponse, setLastResponse] = useState<{ response: SpinResponse; latencyMs: number } | null>(null);

  useControllerEvent((e) => {
    if (!open) return;
    if (e.type === 'transition') setHistory([...controller.getHistory()]);
    if (e.type === 'response') setLastResponse({ response: e.response, latencyMs: e.latencyMs });
  });
  useEffect(() => {
    if (open) setHistory([...controller.getHistory()]);
  }, [open, controller]);

  const exportLog = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), transitions: controller.getHistory() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slot-transitions-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      modal={false}
      className="inspector"
      title={
        <>
          Provider Inspector <kbd>`</kbd>
        </>
      }
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              controller.clearHistory();
              setHistory([]);
            }}
          >
            Clear log
          </button>
          <button type="button" className="btn btn--ghost" onClick={exportLog}>
            Export log
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {open && (
        <>
          <StateSection />
          <PerfSection />
          <ConfigSection />
          <MockSection />
          <LogSection history={history} />
          <ResponseSection last={lastResponse} />
        </>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ state

function StateSection() {
  const { ctx } = useSlot();
  const { formatMoney } = useGame();
  const rows: [string, string][] = [
    ['spinId', String(ctx.spinId)],
    ['rounds', String(ctx.roundsPlayed)],
    ['balance', formatMoney(ctx.balance)],
    ['bet', `${formatMoney(ctx.bet)} (#${ctx.betIndex})`],
    ['turbo', ctx.turbo ? 'on' : 'off'],
    ['autoplay', ctx.autoSpin ? (ctx.autoSpin.infinite ? '∞' : `${ctx.autoSpin.remaining} left`) + (ctx.autoSpin.stopOnWin ? ' · stop on win' : '') : 'off'],
    ['free spins', ctx.freeSpins ? `${ctx.freeSpins.remaining} left / ${ctx.freeSpins.total} · ×${ctx.freeSpins.multiplier}` : '—'],
    ['mode', ctx.round?.request.mode ?? '—'],
    ['last win', `${formatMoney(ctx.lastWin)} (${ctx.lastTier})`],
  ];
  return (
    <section className="insp-section">
      <h3 className="insp-title">State machine</h3>
      <ol className="state-chain">
        {SPIN_STATE_ORDER.map((s) => (
          <li key={s} className={`state-pill ${s === ctx.state ? 'is-active' : ''} ${s === SpinState.ERROR_RECOVERABLE ? 'is-error' : ''}`}>
            {s}
          </li>
        ))}
      </ol>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ performance

function PerfSection() {
  const { stage } = useGame();
  const current = useSyncExternalStore(stage.subscribe, stage.get);
  const [stats, setStats] = useState<FrameStatsSnapshot | null>(null);

  useEffect(() => {
    if (!current) return;
    const id = window.setInterval(() => setStats(current.getStats()), 250);
    return () => window.clearInterval(id);
  }, [current]);

  const info = current?.getRendererInfo();
  const samples = stats?.samples ?? [];
  const W = 280;
  const H = 48;
  const max = 50; // ms ceiling for the chart
  const points = samples.map((v, i) => `${(i / Math.max(1, samples.length - 1)) * W},${H - (Math.min(v, max) / max) * H}`).join(' ');
  const budgetY = H - (16.67 / max) * H;

  return (
    <section className="insp-section">
      <h3 className="insp-title">Performance</h3>
      {!current ? (
        <p className="muted small">Renderer not attached.</p>
      ) : (
        <>
          <div className="perf">
            <div className={`perf__fps ${stats && stats.fps < 50 ? 'is-warn' : ''}`}>
              {stats ? stats.fps.toFixed(0) : '—'}
              <span>fps</span>
            </div>
            <dl className="perf__stats">
              <div>
                <dt>avg</dt>
                <dd>{stats?.avgMs.toFixed(1) ?? '—'} ms</dd>
              </div>
              <div>
                <dt>p95</dt>
                <dd>{stats?.p95Ms.toFixed(1) ?? '—'} ms</dd>
              </div>
              <div>
                <dt>max</dt>
                <dd>{stats?.maxMs.toFixed(1) ?? '—'} ms</dd>
              </div>
              <div>
                <dt>jank</dt>
                <dd>{stats?.jank ?? 0}/240</dd>
              </div>
            </dl>
          </div>
          <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Frame time, last 240 frames">
            <line x1={0} x2={W} y1={budgetY} y2={budgetY} className="sparkline__budget" />
            <polyline points={points} className="sparkline__line" />
          </svg>
          <p className="muted small">
            {info?.name} · resolution ×{info?.resolution} · dashed line = 16.7 ms budget
          </p>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ config

function ConfigSection() {
  const { controller, provider } = useGame();
  const { config, ctx } = useSlot();
  const [sim, setSim] = useState<{ id: string; report: SimulationReport; ms: number } | null>(null);
  const idle = ctx.state === SpinState.IDLE;

  const runSim = () => {
    const t0 = performance.now();
    const report = simulate(config, 20_000, Date.now() & 0xffff);
    setSim({ id: config.id, report, ms: performance.now() - t0 });
  };

  return (
    <section className="insp-section">
      <h3 className="insp-title">Game config</h3>
      <label className="field">
        <span className="field__label">Active title</span>
        <select
          value={config.id}
          disabled={!idle}
          onChange={(e) => {
            const next = getConfig(e.target.value);
            if (next && controller.loadConfig(next)) {
              provider.setWallet(controller.getSnapshot().ctx.balance);
              setSim(null);
            }
          }}
        >
          {GAME_CONFIGS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.layout.reels}×{c.layout.rows}, {c.evaluation.kind})
            </option>
          ))}
        </select>
        {!idle && <span className="field__hint">Switching is allowed only while IDLE.</span>}
      </label>
      <dl className="kv">
        <div className="kv__row">
          <dt>id / version</dt>
          <dd>
            {config.id}@{config.version}
          </dd>
        </div>
        <div className="kv__row">
          <dt>symbols</dt>
          <dd>{config.symbols.length}</dd>
        </div>
        <div className="kv__row">
          <dt>free spins</dt>
          <dd>
            {config.freeSpins.scatterCount}+ scatters → {config.freeSpins.awarded} @ ×{config.freeSpins.multiplier}
          </dd>
        </div>
      </dl>
      <div className="row-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={runSim}>
          Simulate 20k spins
        </button>
      </div>
      {sim && sim.id === config.id && (
        <p className="sim small">
          RTP <strong>{(sim.report.rtp * 100).toFixed(2)}%</strong> · hit {(sim.report.hitRate * 100).toFixed(1)}% · feature 1/
          {Math.round(1 / Math.max(sim.report.featureRate, 1e-9))} · max {sim.report.maxWinX.toFixed(0)}× · {sim.ms.toFixed(0)} ms
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ mock server

function MockSection() {
  const { provider, controller, formatMoney } = useGame();
  const settings = useMockSettings();
  const wallet = useMockWallet();
  const [seed, setSeed] = useState(String(settings.seed));
  const scenarios = useMemo(() => Object.values(ForcedScenario), []);
  const [min, max] = settings.latencyMs;

  return (
    <section className="insp-section">
      <h3 className="insp-title">Mock server (OutcomeProvider)</h3>
      <label className="field">
        <span className="field__label">Force next outcome</span>
        <select value={settings.forced} onChange={(e) => provider.updateSettings({ forced: e.target.value as ForcedScenario })}>
          {scenarios.map((s) => (
            <option key={s} value={s}>
              {SCENARIO_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={settings.forcedOnce} onChange={(e) => provider.updateSettings({ forcedOnce: e.target.checked })} />
        <span>Reset to random after one spin</span>
      </label>

      <label className="field">
        <span className="field__label">
          Latency {min}–{max} ms
        </span>
        <div className="range-pair">
          <input
            type="range"
            min={0}
            max={3000}
            step={20}
            value={min}
            aria-label="Minimum latency"
            onChange={(e) => {
              const v = Number(e.target.value);
              provider.updateSettings({ latencyMs: [v, Math.max(v, max)] });
            }}
          />
          <input
            type="range"
            min={0}
            max={3000}
            step={20}
            value={max}
            aria-label="Maximum latency"
            onChange={(e) => {
              const v = Number(e.target.value);
              provider.updateSettings({ latencyMs: [Math.min(min, v), v] });
            }}
          />
        </div>
      </label>

      <label className="field">
        <span className="field__label">Random network error rate {(settings.errorRate * 100).toFixed(0)}%</span>
        <input
          type="range"
          min={0}
          max={50}
          value={Math.round(settings.errorRate * 100)}
          onChange={(e) => provider.updateSettings({ errorRate: Number(e.target.value) / 100 })}
        />
      </label>

      <form
        className="field field--inline"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(seed);
          if (Number.isFinite(n)) provider.updateSettings({ seed: Math.floor(n) >>> 0 });
        }}
      >
        <label className="field__label" htmlFor="seed-input">
          RNG seed
        </label>
        <input id="seed-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
        <button type="submit" className="btn btn--ghost btn--sm">
          Apply
        </button>
      </form>

      <div className="field field--inline">
        <span className="field__label">Server wallet</span>
        <output>{formatMoney(wallet)}</output>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            provider.setWallet(wallet + 100_000);
            controller.syncBalance();
          }}
        >
          +1,000 top-up
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ log

function LogSection({ history }: { readonly history: readonly TransitionRecord[] }) {
  const rows = history.slice(-100).reverse();
  const t0 = history[0]?.at ?? 0;
  return (
    <section className="insp-section">
      <h3 className="insp-title">
        Transition log <span className="muted small">(newest first · {history.length} events)</span>
      </h3>
      <div className="log" role="log" aria-live="off">
        <table>
          <thead>
            <tr>
              <th scope="col">+ms</th>
              <th scope="col">#</th>
              <th scope="col">event</th>
              <th scope="col">from → to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq} className={r.accepted ? '' : 'is-rejected'} title={`${r.iso}${r.detail ? ` · ${r.detail}` : ''}`}>
                <td className="num">{(r.at - t0).toFixed(0)}</td>
                <td className="num">{r.spinId}</td>
                <td>
                  {r.event}
                  {r.detail && <span className="log__detail">{r.detail}</span>}
                </td>
                <td>{r.from === r.to ? <span className="muted">{r.to}</span> : `${r.from} → ${r.to}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted small">No transitions yet. Press Space to spin.</p>}
      </div>
    </section>
  );
}

function ResponseSection({ last }: { readonly last: { response: SpinResponse; latencyMs: number } | null }) {
  return (
    <section className="insp-section">
      <h3 className="insp-title">Last server response</h3>
      {last ? (
        <details>
          <summary>
            spinId {last.response.spinId} · {last.response.ok ? `win ${last.response.outcome.totalWin}` : last.response.error.code} · {last.latencyMs.toFixed(0)} ms
          </summary>
          <pre className="json">{JSON.stringify(last.response, null, 2)}</pre>
        </details>
      ) : (
        <p className="muted small">No response yet.</p>
      )}
    </section>
  );
}
