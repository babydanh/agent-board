import { useEffect, useState } from 'react';

import { BUSY_SLOW_AFTER_MS } from '../constants.js';
import { busyView } from './busyView.js';

/**
 * One visible "still working" line: spinner, what is happening, how long it has been, and, once it is slower
 * than usual, a way to stop waiting. Pass `since` (ms epoch) to get the clock; `onCancel` to get the way out.
 * `skeleton` adds placeholder bars for a panel whose content has not arrived yet.
 */
export function BusyNote({ text, since, onCancel, skeleton = false }: { text: string; since?: number; onCancel?: () => void; skeleton?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  const view = since === undefined ? null : busyView(since, now, BUSY_SLOW_AFTER_MS);

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <span aria-hidden className="inline-block size-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
        <span className="min-w-0 flex-1">
          {text}
          {view !== null && ` · ${view.seconds} giây`}
          {view?.slow === true && ' · lâu hơn thường'}
        </span>
        {view?.slow === true && onCancel && (
          <button type="button" className="company-btn company-btn-sm company-btn-ghost" onClick={onCancel}>
            Dừng chờ
          </button>
        )}
      </div>
      {skeleton && (
        <div aria-hidden className="flex flex-col gap-1.5">
          <div className="h-3 w-3/4 rounded bg-hairline motion-safe:animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-hairline motion-safe:animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-hairline motion-safe:animate-pulse" />
        </div>
      )}
    </div>
  );
}
