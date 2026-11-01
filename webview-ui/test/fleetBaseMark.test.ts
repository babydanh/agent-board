import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { FleetOverlapWarning } from '../../core/src/messages.js';
import { FleetOverlapItem } from '../src/company/fleet/FleetView.js';

// FleetView pulls in the app transport, which needs a browser window at import time; this test only renders one row.
vi.mock('../src/company/fleet/fleetClient.js', () => ({ fleetStore: {} }));

const base: FleetOverlapWarning = { repo: 'api', path: 'src/a.ts', machines: ['danh', 'danh1'], local: false, level: 'file' };

describe('overlap base mark', () => {
  it('TC-BASE-UI-01: shows "khác nền" only when the warning says the bases differ', () => {
    const marked = renderToStaticMarkup(createElement(FleetOverlapItem, { overlap: { ...base, baseDiffers: true } }));
    const plain = renderToStaticMarkup(createElement(FleetOverlapItem, { overlap: base }));

    expect(marked).toContain('khác nền');
    expect(plain).not.toContain('khác nền');
    expect(plain).toContain('src/a.ts');
  });
});
