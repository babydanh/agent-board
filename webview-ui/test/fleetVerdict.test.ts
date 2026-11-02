import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { FleetOverlapWarning } from '../../core/src/messages.js';
import { FleetOverlapItem } from '../src/company/fleet/FleetView.js';

// FleetView pulls in the app transport, which needs a browser window at import time; this test only renders one row.
vi.mock('../src/company/fleet/fleetClient.js', () => ({ fleetStore: {} }));

const base: FleetOverlapWarning = { repo: 'api', path: 'src/a.ts', machines: ['danh', 'local-pc'], local: false, level: 'line' };
const render = (overlap: FleetOverlapWarning): string => renderToStaticMarkup(createElement(FleetOverlapItem, { overlap }));

describe('overlap verdict', () => {
  it('TC-VERDICT-UI-01: a conflict says git itself found it and keeps the file and lines in view', () => {
    const html = render({ ...base, verdict: 'conflict', detail: 'git: danh ↔ local-pc xung đột dòng 5–7' });
    expect(html).toContain('Git: xung đột');
    expect(html).toContain('src/a.ts');
    expect(html).toContain('dòng 5–7');
  });

  it('TC-VERDICT-UI-02: an incomplete check says so and never reads as clean or auto', () => {
    const html = render({ ...base, verdict: 'incomplete' });
    expect(html).toContain('chưa quét hết');
    expect(html).not.toContain('tự gộp');
    expect(html).not.toContain('sạch');
  });

  it('TC-VERDICT-UI-03: an auto verdict says git merges it by itself', () => {
    expect(render({ ...base, verdict: 'auto' })).toContain('Git: tự gộp được');
  });

  it('TC-VERDICT-UI-04: without a verdict the row shows no git label', () => {
    const html = render(base);
    expect(html).not.toContain('Git:');
    expect(html).not.toContain('chưa quét hết');
  });
});
