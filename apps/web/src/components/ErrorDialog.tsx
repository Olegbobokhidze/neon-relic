import { useEffect, useId, useRef } from 'react';
import { SpinState, type ProviderErrorCode } from '@slot/engine';
import { useGame, useSlot } from '../hooks/game';

const COPY: Readonly<Record<ProviderErrorCode, { title: string; body: string }>> = {
  NETWORK: { title: 'Connection lost', body: 'We could not reach the game server. Your stake has been returned.' },
  TIMEOUT: { title: 'Server is taking too long', body: 'The round did not start in time. Your stake has been returned.' },
  INSUFFICIENT_FUNDS: { title: 'Insufficient balance', body: 'Lower your bet or top up your balance to keep playing.' },
  VALIDATION: { title: 'Round could not be verified', body: 'The result failed a client integrity check. Your balance has been re-synced.' },
  SERVER: { title: 'Server error', body: 'Something went wrong on our side. Please try again.' },
};

export function ErrorDialog() {
  const { controller } = useGame();
  const { ctx } = useSlot();
  const titleId = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const open = ctx.state === SpinState.ERROR_RECOVERABLE && ctx.error !== null;

  useEffect(() => {
    if (open) primary.current?.focus();
  }, [open]);

  if (!open || !ctx.error) return null;
  const copy = COPY[ctx.error.code];

  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-d`}>
        <div className="modal__code">{ctx.error.code}</div>
        <h2 id={titleId} className="modal__title">
          {copy.title}
        </h2>
        <p id={`${titleId}-d`} className="modal__body">
          {copy.body}
        </p>
        <p className="modal__detail">{ctx.error.message}</p>
        <div className="modal__actions">
          {!ctx.error.recoverable && (
            <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
              Reload game
            </button>
          )}
          <button ref={primary} type="button" className="btn btn--primary" onClick={() => controller.recover()}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
