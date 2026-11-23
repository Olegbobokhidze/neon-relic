import { useEffect, useRef, useState } from 'react';
import { SpinState } from '@slot/engine';
import { useCountUp, useGame, useSlot } from '../hooks/game';
import { IconAuto, IconBolt, IconMinus, IconPlus, IconSpin, IconStop } from './icons';

const AUTO_OPTIONS = [10, 25, 50, 100, 'infinite'] as const;

export function Hud() {
  const { controller, formatMoney } = useGame();
  const { ctx, config } = useSlot();
  const idle = ctx.state === SpinState.IDLE;
  // During free spins, the current round's win is only folded into totalWin once the round settles.
  const pendingWin = ctx.state === SpinState.WIN_PRESENTATION ? ctx.lastWin : 0;
  const shownWin = useCountUp(ctx.freeSpins ? ctx.freeSpins.totalWin + pendingWin : ctx.lastWin);
  const presets = config.bet.presets;

  return (
    <section className="hud" aria-label="Game controls">
      <div className="hud__meter hud__meter--balance">
        <span className="meter__label">Balance</span>
        <output className="meter__value" aria-live="polite">
          {formatMoney(ctx.balance)}
        </output>
      </div>

      <div className="hud__bet">
        <span className="meter__label">Bet</span>
        <div className="stepper">
          <button
            type="button"
            className="stepper__btn"
            onClick={() => controller.setBetIndex(ctx.betIndex - 1)}
            disabled={!idle || ctx.betIndex <= 0}
            aria-label="Decrease bet"
          >
            <IconMinus />
          </button>
          <output className="stepper__value">{formatMoney(ctx.bet)}</output>
          <button
            type="button"
            className="stepper__btn"
            onClick={() => controller.setBetIndex(ctx.betIndex + 1)}
            disabled={!idle || ctx.betIndex >= presets.length - 1}
            aria-label="Increase bet"
          >
            <IconPlus />
          </button>
        </div>
      </div>

      <div className={`hud__meter hud__meter--win ${shownWin > 0 ? 'has-win' : ''}`}>
        <span className="meter__label">{ctx.freeSpins ? 'Feature win' : 'Win'}</span>
        <output className="meter__value meter__value--win" aria-live="polite">
          {formatMoney(shownWin)}
        </output>
        {ctx.freeSpins && (
          <span className="fs-badge">
            Free spins {Math.min(ctx.freeSpins.played + 1, ctx.freeSpins.total)}/{ctx.freeSpins.total} · ×{ctx.freeSpins.multiplier}
          </span>
        )}
      </div>

      <div className="hud__actions">
        <AutoPlay />
        <button
          type="button"
          className={`toggle-btn ${ctx.turbo ? 'is-on' : ''}`}
          onClick={() => controller.setTurbo(!ctx.turbo)}
          aria-pressed={ctx.turbo}
          aria-label="Turbo spin"
        >
          <IconBolt />
          <span className="toggle-btn__label">Turbo</span>
        </button>
        <SpinButton />
      </div>
    </section>
  );
}

function SpinButton() {
  const { controller } = useGame();
  const { ctx } = useSlot();
  const s = ctx.state;
  const busy = s !== SpinState.IDLE;
  const blocked = s === SpinState.BONUS_OR_FREE_SPINS || s === SpinState.ERROR_RECOVERABLE || s === SpinState.EVALUATING;
  const auto = ctx.autoSpin;
  const label = auto ? 'Stop autoplay' : busy ? 'Stop' : 'Spin';

  return (
    <button
      type="button"
      className={`spin-btn ${busy ? 'is-busy' : ''} ${auto ? 'is-auto' : ''}`}
      onClick={() => controller.spinOrStop()}
      disabled={blocked && !auto}
      aria-label={label}
      data-state={s}
    >
      <span className="spin-btn__ring" aria-hidden="true" />
      {auto ? (
        <span className="spin-btn__count">{auto.infinite ? '∞' : auto.remaining}</span>
      ) : busy ? (
        <IconStop width={28} height={28} />
      ) : (
        <IconSpin width={36} height={36} />
      )}
    </button>
  );
}

function AutoPlay() {
  const { controller } = useGame();
  const { ctx } = useSlot();
  const [open, setOpen] = useState(false);
  const [stopOnWin, setStopOnWin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const idle = ctx.state === SpinState.IDLE;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (ctx.autoSpin) {
    return (
      <button type="button" className="toggle-btn is-on" onClick={() => controller.stopAuto()} aria-label="Stop autoplay">
        <IconAuto />
        <span className="toggle-btn__label">Stop</span>
      </button>
    );
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="toggle-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={!idle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Autoplay"
      >
        <IconAuto />
        <span className="toggle-btn__label">Auto</span>
      </button>
      {open && (
        <div className="popover" role="menu" aria-label="Autoplay rounds">
          <div className="popover__title">Autoplay</div>
          <div className="popover__grid">
            {AUTO_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitem"
                className="chip"
                onClick={() => {
                  setOpen(false);
                  controller.startAuto(n, stopOnWin);
                }}
              >
                {n === 'infinite' ? '∞' : n}
              </button>
            ))}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={stopOnWin} onChange={(e) => setStopOnWin(e.target.checked)} />
            <span>Stop on any win</span>
          </label>
        </div>
      )}
    </div>
  );
}
