import type { CSSProperties } from 'react';
import type { GameConfig, SymbolDef } from '@slot/engine';
import { useGame, useSlot } from '../hooks/game';
import { Drawer } from './Drawer';

type Props = { readonly open: boolean; readonly onClose: () => void };

/** Generated from GameConfig, so it can never drift from the maths (ADR-0005). */
export function PaytableDrawer({ open, onClose }: Props) {
  const { config, ctx } = useSlot();
  const { formatMoney } = useGame();
  const coin = ctx.bet / config.evaluation.betDivisor;
  const order = (s: SymbolDef) => (s.kind === 'wild' ? 0 : s.kind === 'scatter' ? 1 : 2);
  const symbols = [...config.symbols].sort((a, b) => order(a) - order(b));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Paytable & Rules"
      className="paytable"
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose} data-autofocus>
          Back to game
        </button>
      }
    >
      <p className="muted">
        Values shown for the current bet of <strong>{formatMoney(ctx.bet)}</strong>.
        {config.evaluation.kind === 'ways' && ' Ways wins pay per way, times the number of ways.'}
      </p>

      <ul className="paytable__list">
        {symbols.map((s) => {
          const counts = Object.entries(s.pays)
            .map(([n, mult]) => [Number(n), mult ?? 0] as const)
            .filter(([, mult]) => mult > 0)
            .sort((a, b) => b[0] - a[0]);
          return (
            <li key={s.id} className="paytable__row">
              <SymbolBadge symbol={s} />
              <div className="paytable__info">
                <div className="paytable__name">
                  {s.name}
                  {s.kind !== 'regular' && <span className="tag">{s.kind}</span>}
                </div>
                {counts.length > 0 ? (
                  <dl className="paytable__pays">
                    {counts.map(([n, mult]) => (
                      <div key={n} className="paytable__pay">
                        <dt>{n}×</dt>
                        <dd>{formatMoney(Math.round(s.kind === 'scatter' ? mult * ctx.bet : mult * coin))}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="muted small">Substitutes for all symbols except scatter.</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <h3 className="section-title">Rules</h3>
      <Rules config={config} />

      {config.evaluation.kind === 'lines' && (
        <>
          <h3 className="section-title">Paylines</h3>
          <div className="paylines">
            {config.evaluation.lines.map((line, i) => (
              <Payline key={i} index={i} line={line} rows={config.layout.rows} color={config.theme.lineColors[i % config.theme.lineColors.length] ?? '#fff'} />
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}

function Rules({ config }: { readonly config: GameConfig }) {
  const scatter = config.symbols.find((s) => s.kind === 'scatter');
  const wild = config.symbols.find((s) => s.kind === 'wild');
  return (
    <ul className="rules">
      {config.evaluation.kind === 'lines' ? (
        <li>
          {config.evaluation.lines.length} fixed paylines. Wins pay left to right from the first reel on adjacent reels. Only the highest win per line is paid.
        </li>
      ) : (
        <li>
          {Math.pow(config.layout.rows, config.layout.reels)} ways: matching symbols on adjacent reels from the left, in any row.
        </li>
      )}
      {wild && <li>{wild.name} substitutes for all symbols except {scatter?.name ?? 'scatter'}.</li>}
      {scatter && (
        <li>
          {config.freeSpins.scatterCount}+ {scatter.name} anywhere award {config.freeSpins.awarded} free spins, where all wins are multiplied by ×
          {config.freeSpins.multiplier}. Free spins can be retriggered.
        </li>
      )}
      <li>Outcomes are decided by the game server. Malfunction voids all pays and plays.</li>
    </ul>
  );
}

export function SymbolBadge({ symbol, size = 48 }: { readonly symbol: SymbolDef; readonly size?: number }) {
  const style = { '--sym-color': symbol.art.color, '--sym-accent': symbol.art.accent, width: size, height: size } as CSSProperties;
  return (
    <span className={`sym-badge sym-badge--${symbol.art.shape}`} style={style} aria-hidden="true">
      <span className="sym-badge__glyph">{symbol.art.glyph}</span>
    </span>
  );
}

function Payline({ index, line, rows, color }: { readonly index: number; readonly line: readonly number[]; readonly rows: number; readonly color: string }) {
  const w = 10 + line.length * 12;
  const h = 6 + rows * 12;
  const pts = line.map((row, reel) => `${11 + reel * 12},${9 + row * 12}`).join(' ');
  return (
    <figure className="payline" aria-label={`Line ${index + 1}`}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
        {line.map((_, reel) =>
          Array.from({ length: rows }, (_, row) => <rect key={`${reel}-${row}`} x={6 + reel * 12} y={4 + row * 12} width={10} height={10} rx={2} className="payline__cell" />),
        )}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption>{index + 1}</figcaption>
    </figure>
  );
}
