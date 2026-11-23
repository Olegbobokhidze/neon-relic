import { describe, expect, it } from 'vitest';
import { SoundManager, Sfx } from './sound-manager';
import { createMemoryStorage } from './storage';

describe('SoundManager', () => {
  it('is a safe no-op when Web Audio is unavailable', () => {
    const s = new SoundManager({ storage: createMemoryStorage(), audioContext: null });
    expect(s.getState().status).toBe('unavailable');
    expect(() => {
      s.unlock();
      s.play(Sfx.WIN_BIG);
      s.startLoop();
      s.stopLoop();
      s.setPageVisible(false);
      s.dispose();
    }).not.toThrow();
  });

  it('survives an AudioContext constructor that throws (autoplay policy, sandbox)', () => {
    const Throwing = class {
      constructor() {
        throw new Error('NotAllowedError');
      }
    } as unknown as new () => AudioContext;
    const s = new SoundManager({ storage: createMemoryStorage(), audioContext: Throwing });
    expect(() => s.unlock()).not.toThrow();
    expect(s.getState().status).toBe('unavailable');
  });

  it('persists volume and mute, and ignores corrupt stored prefs', () => {
    const storage = createMemoryStorage();
    const a = new SoundManager({ storage, audioContext: null });
    a.setVolume(0.25);
    a.setMuted(true);
    const b = new SoundManager({ storage, audioContext: null });
    expect(b.getState()).toMatchObject({ volume: 0.25, muted: true });

    storage.set('slot.audio.v1', '{not json');
    expect(new SoundManager({ storage, audioContext: null }).getState()).toMatchObject({ volume: 0.7, muted: false });
  });

  it('clamps volume', () => {
    const s = new SoundManager({ storage: createMemoryStorage(), audioContext: null });
    s.setVolume(4);
    expect(s.getState().volume).toBe(1);
  });
});
