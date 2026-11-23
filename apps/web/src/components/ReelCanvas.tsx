import { useEffect, useRef, useState } from 'react';
import { Sfx } from '@slot/audio';
import { ReelStage } from '@slot/renderer-pixi';
import { useGame, useSlot } from '../hooks/game';

/**
 * Bridge between React and the Pixi stage. Mounts once and never re-renders per frame.
 * The stage attaches itself to the controller as its `ReelsPort`.
 */
export function ReelCanvas() {
  const { controller, sound, stage: holder, formatMoney } = useGame();
  const { config } = useSlot();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let stage: ReelStage | null = null;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    ReelStage.create({
      host,
      config: configRef.current,
      formatMoney,
      reducedMotion,
      events: {
        onReelStop: (i, scatter) => sound.play(scatter ? Sfx.SCATTER_LAND : Sfx.REEL_STOP, { pitch: 1 + i * 0.05 }),
        onTeaseStart: () => sound.play(Sfx.TEASE),
        onContextLost: () => setFailed('The graphics context was lost. Reload to continue.'),
      },
    }).then(
      (s) => {
        if (cancelled) {
          s.destroy();
          return;
        }
        stage = s;
        controller.attachReels(s);
        holder.set(s);
      },
      (err: unknown) => setFailed(`WebGL is unavailable: ${err instanceof Error ? err.message : String(err)}`),
    );

    return () => {
      cancelled = true;
      controller.attachReels(null);
      holder.set(null);
      stage?.destroy();
    };
  }, [controller, sound, holder, formatMoney]);

  // Skin / layout swap.
  useEffect(() => {
    holder.get()?.rebuild(config);
  }, [config, holder]);

  return (
    <div className="reel-canvas" ref={hostRef}>
      {failed && (
        <div className="reel-canvas__error" role="alert">
          {failed}
        </div>
      )}
    </div>
  );
}
