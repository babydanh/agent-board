import './StartLog.css';

import { useEffect, useState } from 'react';

import type { StartStep } from '../herdrView.js';

/** Widths of the grey bars: uneven, so they read as lines of terminal text. */
const BONE_WIDTHS: readonly string[] = ['72%', '90%', '55%', '82%', '40%'];
const STATE_MARK: Readonly<Record<StartStep['state'], string>> = { done: '✓', active: '…', todo: '·' };

/**
 * StartLog: what a session start is doing right now. The steps say where it is (the active one also
 * counts seconds from `since`, else from mount; hidden from screen readers so the live region does not
 * re-announce every second) and grey bars hold the place of the terminal that is about to appear.
 */
export function StartLog({ steps, bones = true, since }: { steps: readonly StartStep[]; bones?: boolean; since?: number }) {
  const [mountedAt] = useState(() => Date.now());
  const startedAt = since ?? mountedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - startedAt) / 1000);
  return (
    <div role="status" data-testid="start-log" className="start-log">
      <ol className="start-log__steps">
        {steps.map((step) => (
          <li key={step.label} className="start-log__step" data-state={step.state}>
            {STATE_MARK[step.state]} {step.label}
            {step.state === 'active' && <span aria-hidden="true"> ({seconds}s)</span>}
          </li>
        ))}
      </ol>
      {bones && (
        <div aria-hidden="true" className="start-log__bones">
          {BONE_WIDTHS.map((width) => (
            <div key={width} className="start-log__bone" style={{ width }} />
          ))}
        </div>
      )}
    </div>
  );
}
