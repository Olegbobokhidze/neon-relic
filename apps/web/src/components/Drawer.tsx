import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

export type DrawerProps = {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Footer actions; rendered right-aligned with the primary action last. */
  readonly footer?: ReactNode;
  /** Modal drawers trap attention with a backdrop; non-modal ones (inspector) let you keep playing. */
  readonly modal?: boolean;
  readonly side?: 'right' | 'left';
  readonly className?: string;
};

export function Drawer({ open, title, onClose, children, footer, modal = true, side = 'right', className = '' }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // `inert` keeps a closed drawer out of the tab order (set imperatively for React 18 compatibility).
  useEffect(() => {
    panelRef.current?.toggleAttribute('inert', !open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modal) panelRef.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus();
    return () => {
      if (modal) returnFocus.current?.focus?.();
    };
  }, [open, modal]);

  return (
    <>
      {modal && <div className={`drawer-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden="true" />}
      <aside
        ref={panelRef}
        className={`drawer drawer--${side} ${open ? 'is-open' : ''} ${className}`}
        role={modal ? 'dialog' : 'complementary'}
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        aria-hidden={!open}
      >
        <header className="drawer__header">
          <h2 id={titleId} className="drawer__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__footer">{footer}</footer>}
      </aside>
    </>
  );
}
