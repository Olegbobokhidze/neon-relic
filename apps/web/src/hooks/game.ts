import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ControllerEvent, ControllerSnapshot } from '@slot/engine';
import type { MockSettings } from '@slot/adapters';
import type { SoundState } from '@slot/audio';
import type { Game } from '../composition';

export const GameContext = createContext<Game | null>(null);

export function useGame(): Game {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame must be used inside <GameContext.Provider>');
  return game;
}

/** Engine snapshot via useSyncExternalStore: tear-free and render-cheap. */
export function useSlot(): ControllerSnapshot {
  const { controller } = useGame();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

export function useSoundState(): SoundState {
  const { sound } = useGame();
  return useSyncExternalStore(
    (l) => sound.subscribe(l),
    () => sound.getState(),
  );
}

export function useMockSettings(): MockSettings {
  const { provider } = useGame();
  return useSyncExternalStore(
    (l) => provider.subscribe(l),
    () => provider.getSettings(),
  );
}

export function useMockWallet(): number {
  const { provider } = useGame();
  return useSyncExternalStore(
    (l) => provider.subscribe(l),
    () => provider.getWallet(),
  );
}

export function useControllerEvent(handler: (e: ControllerEvent) => void): void {
  const { controller } = useGame();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => controller.on((e) => ref.current(e)), [controller]);
}

const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Animate a displayed number toward `target` (rAF, single text node; cheap). */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (target === 0 || prefersReducedMotion()) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = target < fromRef.current ? 0 : fromRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - u, 3);
      const v = Math.round(from + (target - from) * eased);
      setValue(v);
      fromRef.current = v;
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
