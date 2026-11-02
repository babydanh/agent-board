import { describe, expect, it } from 'vitest';

import { silenceLabel } from '../src/company/fleet/machineSilence.js';

const MIN = 60_000;

describe('machine silence label', () => {
  it('TC-SILENCE-02: a machine silent past the threshold reads as silent with how long, in a warning tone, not as an error', () => {
    const label = silenceLabel('stale', 0, 25 * MIN);
    expect(label.text).toContain('Im lặng');
    expect(label.text).toContain('25 phút');
    expect(label.className).toBe('text-warning');
    expect(label.text).not.toMatch(/lỗi/i);
  });

  it('counts hours and days once the silence is long, so a machine asleep for a week does not read "10080 phút"', () => {
    expect(silenceLabel('stale', 0, 3 * 60 * MIN).text).toContain('3 giờ');
    expect(silenceLabel('stale', 0, 5 * 24 * 60 * MIN).text).toContain('5 ngày');
  });

  it('an online machine keeps its plain label', () => {
    expect(silenceLabel('online', 0, MIN)).toEqual({ text: 'Đang hoạt động', className: 'text-text-muted' });
  });
});
