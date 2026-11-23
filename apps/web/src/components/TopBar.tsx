import { useGame, useSlot, useSoundState } from '../hooks/game';
import { IconCode, IconInfo, IconMute, IconSound } from './icons';

type Props = {
  readonly onPaytable: () => void;
  readonly onInspector: () => void;
  readonly inspectorOpen: boolean;
};

export function TopBar({ onPaytable, onInspector, inspectorOpen }: Props) {
  const { sound } = useGame();
  const { config } = useSlot();
  const audio = useSoundState();
  const silent = audio.muted || audio.status === 'unavailable';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true" />
        <span className="brand__title">{config.title}</span>
        <span className="brand__meta">
          {config.layout.reels}×{config.layout.rows} ·{' '}
          {config.evaluation.kind === 'lines' ? `${config.evaluation.lines.length} lines` : `${Math.pow(config.layout.rows, config.layout.reels)} ways`}
        </span>
      </div>
      <div className="topbar__actions">
        <div className="sound-control">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              sound.unlock();
              sound.toggleMuted();
            }}
            aria-pressed={audio.muted}
            aria-label={audio.muted ? 'Unmute sound' : 'Mute sound'}
            title={audio.status === 'unavailable' ? 'Audio unavailable in this browser' : undefined}
          >
            {silent ? <IconMute /> : <IconSound />}
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={100}
            value={Math.round(audio.volume * 100)}
            onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
            aria-label="Volume"
            disabled={audio.muted}
          />
        </div>
        <button type="button" className="icon-btn" onClick={onPaytable} aria-label="Paytable and rules">
          <IconInfo />
        </button>
        <button
          type="button"
          className={`icon-btn icon-btn--dev ${inspectorOpen ? 'is-active' : ''}`}
          onClick={onInspector}
          aria-pressed={inspectorOpen}
          aria-label="Toggle provider inspector (backtick)"
          title="Provider Inspector ( ` )"
        >
          <IconCode />
          <span className="icon-btn__label">DEV</span>
        </button>
      </div>
    </header>
  );
}
