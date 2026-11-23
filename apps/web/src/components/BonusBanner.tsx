import { useEffect, useState } from 'react';
import { useControllerEvent, useGame, useSlot } from '../hooks/game';

type Banner =
  | { readonly kind: 'bonus'; readonly awarded: number; readonly retrigger: boolean; readonly until: number }
  | { readonly kind: 'complete'; readonly totalWin: number; readonly spins: number; readonly until: number };

export function BonusBanner() {
  const { formatMoney } = useGame();
  const { config } = useSlot();
  const [banner, setBanner] = useState<Banner | null>(null);

  useControllerEvent((e) => {
    if (e.type === 'bonus') setBanner({ kind: 'bonus', awarded: e.awarded, retrigger: e.retrigger, until: e.durationMs });
    if (e.type === 'featureComplete') setBanner({ kind: 'complete', totalWin: e.totalWin, spins: e.spins, until: 2600 });
  });

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), Math.max(600, banner.until - 200));
    return () => window.clearTimeout(t);
  }, [banner]);

  if (!banner) return null;
  return (
    <div className="banner" role="status" aria-live="assertive">
      {banner.kind === 'bonus' ? (
        <>
          <div className="banner__kicker">{banner.retrigger ? 'Retrigger' : 'Feature triggered'}</div>
          <div className="banner__title">{banner.awarded} Free Spins</div>
          <div className="banner__sub">All wins ×{config.freeSpins.multiplier}</div>
        </>
      ) : (
        <>
          <div className="banner__kicker">Feature complete · {banner.spins} spins</div>
          <div className="banner__title">{formatMoney(banner.totalWin)}</div>
          <div className="banner__sub">Total feature win</div>
        </>
      )}
    </div>
  );
}
