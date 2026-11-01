import { describe, expect, it } from 'vitest';

import { CLOUD_HISTORY_AUTO_COOLDOWN_MS, shouldOpenHistory } from '../src/company/fleet/cloudHistoryTrigger.js';

const base = { deltaY: -120, viewportY: 0, busy: false, lastOpenedAt: null as number | null, now: 100_000 };

describe('shouldOpenHistory (TC-CLOUDHIST-01)', () => {
  it('opens when the wheel goes up while the view already shows the top line', () => {
    expect(shouldOpenHistory(base)).toBe(true);
  });

  it('does not open while the view can still scroll up locally', () => {
    expect(shouldOpenHistory({ ...base, viewportY: 3 })).toBe(false);
  });

  it('does not open on a downward wheel', () => {
    expect(shouldOpenHistory({ ...base, deltaY: 120 })).toBe(false);
  });

  it('does not open while a history request is already running', () => {
    expect(shouldOpenHistory({ ...base, busy: true })).toBe(false);
  });

  it('waits out the cooldown after the last automatic open so closing the view does not reopen it', () => {
    expect(shouldOpenHistory({ ...base, lastOpenedAt: base.now - CLOUD_HISTORY_AUTO_COOLDOWN_MS + 1 })).toBe(false);
    expect(shouldOpenHistory({ ...base, lastOpenedAt: base.now - CLOUD_HISTORY_AUTO_COOLDOWN_MS })).toBe(true);
  });
});
