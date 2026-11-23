import { useCallback, useEffect, useState } from 'react';
import type { GameConfig } from '@slot/engine';
import { BonusBanner } from './components/BonusBanner';
import { ErrorDialog } from './components/ErrorDialog';
import { Hud } from './components/Hud';
import { InspectorDrawer } from './components/InspectorDrawer';
import { PaytableDrawer } from './components/PaytableDrawer';
import { ReelCanvas } from './components/ReelCanvas';
import { TopBar } from './components/TopBar';
import { useGame, useSlot } from './hooks/game';

function applyTheme(config: GameConfig): void {
  const t = config.theme;
  const root = document.documentElement.style;
  const vars: Record<string, string> = {
    '--c-bg': t.background,
    '--c-bg-accent': t.backgroundAccent,
    '--c-reel': t.reelBackground,
    '--c-frame': t.frame,
    '--c-glow': t.glow,
    '--c-text': t.text,
    '--c-muted': t.textMuted,
    '--c-primary': t.primary,
    '--c-on-primary': t.primaryText,
    '--c-win': t.win,
    '--c-danger': t.danger,
    '--font-display': t.fontDisplay,
  };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.background);
  document.title = `${config.title} · Slot`;
}

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(el.tagName));

export function App() {
  const game = useGame();
  const { controller, sound } = game;
  const { config, ctx } = useSlot();
  const [paytableOpen, setPaytableOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(game.initialInspectorOpen);

  useEffect(() => applyTheme(config), [config]);

  // Audio unlock on first gesture; pause audio in background tabs.
  useEffect(() => {
    const unlock = () => sound.unlock();
    const vis = () => sound.setPageVisible(document.visibilityState === 'visible');
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [sound]);

  const modalOpen = paytableOpen || ctx.state === 'ERROR_RECOVERABLE';

  // Keyboard: Space/Enter = spin/stop, ` = inspector, Esc = close drawers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`') {
        e.preventDefault();
        setInspectorOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setPaytableOpen(false);
        return;
      }
      if ((e.code === 'Space' || e.key === 'Enter') && !modalOpen && !isTypingTarget(e.target)) {
        e.preventDefault();
        if (!e.repeat) controller.spinOrStop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, modalOpen]);

  const togglePaytable = useCallback(() => setPaytableOpen((v) => !v), []);
  const toggleInspector = useCallback(() => setInspectorOpen((v) => !v), []);

  return (
    <div className="app" data-state={ctx.state} data-inspector={inspectorOpen ? 'open' : 'closed'}>
      <TopBar onPaytable={togglePaytable} onInspector={toggleInspector} inspectorOpen={inspectorOpen} />
      <main className="stage" aria-label={`${config.title} reels`}>
        <ReelCanvas />
        <BonusBanner />
      </main>
      <Hud />
      <PaytableDrawer open={paytableOpen} onClose={() => setPaytableOpen(false)} />
      <InspectorDrawer open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      <ErrorDialog />
    </div>
  );
}
