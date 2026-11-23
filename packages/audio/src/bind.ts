import { SpinState, WinTier, type SlotController } from '@slot/engine';
import { Sfx, type SoundManager } from './sound-manager';

/**
 * Wire controller events to sound. Audio stays a pure observer of the engine (ADR-0001);
 * renderer-driven cues (reel stops, tease) are wired separately in the composition root.
 */
export function bindAudio(controller: SlotController, sound: SoundManager): () => void {
  return controller.on((e) => {
    if (e.type === 'bonus') {
      sound.play(Sfx.BONUS);
      return;
    }
    if (e.type === 'featureComplete') {
      sound.play(Sfx.FEATURE_END);
      return;
    }
    if (e.type !== 'transition' || !e.record.accepted || e.record.from === e.record.to) return;

    switch (e.record.to) {
      case SpinState.SPIN_REQUESTED:
        sound.play(Sfx.SPIN_START);
        sound.startLoop();
        break;
      case SpinState.EVALUATING:
      case SpinState.ERROR_RECOVERABLE:
        sound.stopLoop();
        if (e.record.to === SpinState.ERROR_RECOVERABLE) sound.play(Sfx.ERROR);
        break;
      case SpinState.WIN_PRESENTATION: {
        const tier = controller.getSnapshot().ctx.lastTier;
        sound.play(tier === WinTier.SMALL ? Sfx.WIN_SMALL : Sfx.WIN_BIG);
        break;
      }
    }
  });
}
