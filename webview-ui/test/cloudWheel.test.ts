import { describe, expect, it } from 'vitest';

import { keepWheelOutOfSession } from '../src/company/fleet/cloudWheel.js';

function attached(): (event: WheelEvent) => boolean {
  let handler: ((event: WheelEvent) => boolean) | undefined;
  keepWheelOutOfSession({ attachCustomWheelEventHandler: (h) => (handler = h) });
  if (!handler) throw new Error('no wheel handler attached');
  return handler;
}

describe('keepWheelOutOfSession (TC-CLOUDWHEEL-01)', () => {
  it('attaches a handler that tells xterm to skip its wheel-to-arrow-keys conversion', () => {
    expect(attached()({ deltaY: -120 } as WheelEvent)).toBe(false);
  });

  it('does so for scrolling down as well', () => {
    expect(attached()({ deltaY: 120 } as WheelEvent)).toBe(false);
  });
});
