import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ClientMessage, FleetCleanupItem, FleetCleanupPlanMessage, ServerMessage } from '../../core/src/messages.js';
import { CleanupDialog } from '../src/company/fleet/CleanupDialog.js';
import { cleanupView } from '../src/company/fleet/cleanupView.js';
import { createFleetStore } from '../src/company/fleet/fleetStore.js';

// The dialog lives in the fleet module whose client needs a browser window at import time.
vi.mock('../src/company/fleet/fleetClient.js', () => ({ fleetStore: {} }));

const item = (over: Partial<FleetCleanupItem> = {}): FleetCleanupItem => ({
  machine: 'danh', repo: '/data/home/shop', path: '/w/a', branch: 'feat/a', dirty: 1, unpushed: 0, backedUp: false, prunable: false, idleDays: 3, reason: '1 tệp chưa commit', ...over,
});
const plan = (over: Partial<FleetCleanupPlanMessage> = {}): FleetCleanupPlanMessage => ({
  type: 'fleetCleanupPlan', requestId: 'p1', staging: [item(), item({ machine: 'danh1', path: '/w/b', branch: 'feat/b' })], junk: [item({ path: '/w/old', branch: 'feat/old', dirty: 0, reason: 'Đã gộp' })], kept: [item({ path: '/w/busy', reason: 'Đang có phiên làm việc' })], ...over,
});

describe('cleanup store', () => {
  it('asks for the plan and keeps only the answer to that request', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => 'p1' });
    store.requestCleanupPlan();
    expect(sent).toEqual([{ type: 'fleetCleanupPlanRequest', requestId: 'p1' }]);
    store.accept(plan({ requestId: 'other' }) as ServerMessage);
    expect(store.getSnapshot().cleanup.plan).toBeNull();
    store.accept(plan() as ServerMessage);
    expect(store.getSnapshot().cleanup.plan?.staging).toHaveLength(2);
  });

  it('starts a run with the ticked items only, follows its progress and ends with the done message', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => 'r1' });
    store.startCleanup([{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], [{ machine: 'danh', path: '/w/old' }]);
    expect(sent).toEqual([{ type: 'fleetCleanupStart', requestId: 'r1', staging: [{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], junk: [{ machine: 'danh', path: '/w/old' }] }]);
    store.accept({ type: 'fleetCleanupProgress', requestId: 'r1', step: 'backup', machine: 'danh', path: '/w/a', branch: 'feat/a', status: 'running' } as ServerMessage);
    store.accept({ type: 'fleetCleanupProgress', requestId: 'zzz', step: 'tests', machine: 'danh', path: '/w/a', status: 'ok' } as ServerMessage);
    expect(store.getSnapshot().cleanup.run?.events).toHaveLength(1);
    store.accept({ type: 'fleetCleanupDone', requestId: 'r1', ok: true, staged: 1, cleaned: 1, failed: 0, skipped: 0 } as ServerMessage);
    expect(store.getSnapshot().cleanup.run?.done).toMatchObject({ ok: true, staged: 1 });
  });

  it('a second start while a run is still going sends nothing', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => `r${sent.length + 1}` });
    store.startCleanup([{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], []);
    store.startCleanup([{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], []);
    expect(sent).toHaveLength(1);
  });

  it('keeps the reason when the board refuses the request', () => {
    const store = createFleetStore({ send: () => undefined, newRequestId: () => 'r1' });
    store.startCleanup([{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], []);
    store.accept({ type: 'fleetCommandResult', requestId: 'r1', ok: false, code: 'forbidden', reason: 'Kết nối chỉ đọc' } as ServerMessage);
    expect(store.getSnapshot().cleanup.error).toBe('Kết nối chỉ đọc');
    expect(store.getSnapshot().cleanup.run).toBeNull();
  });
});

describe('cleanup dialog', () => {
  const render = (props: Partial<Parameters<typeof CleanupDialog>[0]> = {}): string =>
    renderToStaticMarkup(createElement(CleanupDialog, { cleanup: { planRequestId: null, plan: plan(), run: null, error: null }, overlaps: [], onRefresh: () => undefined, onStart: () => undefined, onClose: () => undefined, ...props }));

  it('TC-CLEAN-UI-01: every item starts unticked, in two lists, with the kept ones explained', () => {
    const html = render();
    expect(html).not.toContain('checked=""');
    for (const text of ['feat/a', 'feat/b', 'feat/old', 'Đang có phiên làm việc']) expect(html).toContain(text);
  });

  it('TC-CLEAN-UI-02: Start is disabled while nothing is ticked and enabled once something is', () => {
    expect(cleanupView(plan(), new Set(), []).canStart).toBe(false);
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Bắt đầu/);
    expect(cleanupView(plan(), new Set(['danh\u0000/w/old']), []).canStart).toBe(true);
  });

  it('TC-CLEAN-UI-03: the final message says production only moves on the user\'s own instruction', () => {
    const html = render({ cleanup: { planRequestId: null, plan: plan(), run: { requestId: 'r1', events: [], done: { type: 'fleetCleanupDone', requestId: 'r1', ok: true, staged: 1, cleaned: 0, failed: 0, skipped: 0 } }, error: null } });
    expect(html).toContain('production');
    expect(html).toContain('bạn');
  });

  it('TC-CLEAN-UI-04: two ticked branches whose git verdict is conflict or incomplete disable Start and name the pair', () => {
    const ticked = new Set(['danh\u0000/w/a', 'danh1\u0000/w/b']);
    const view = cleanupView(plan(), ticked, [{ repo: 'shop', path: 'a.ts', machines: ['danh', 'danh1'], local: false, verdict: 'conflict' }]);
    expect(view.canStart).toBe(false);
    expect(view.blocked.map((pair) => `${pair.a.branch} ↔ ${pair.b.branch}`)).toEqual(['feat/a ↔ feat/b']);
    const incomplete = cleanupView(plan(), ticked, [{ repo: 'shop', path: 'a.ts', machines: ['danh', 'danh1'], local: false, verdict: 'incomplete' }]);
    expect(incomplete.canStart).toBe(false);
    expect(cleanupView(plan(), ticked, [{ repo: 'shop', path: 'a.ts', machines: ['danh', 'danh1'], local: false, verdict: 'auto' }]).canStart).toBe(true);
    const html = render({ overlaps: [{ repo: 'shop', path: 'a.ts', machines: ['danh', 'danh1'], local: false, verdict: 'conflict' }], initialTicked: ['danh\u0000/w/a', 'danh1\u0000/w/b'] });
    expect(html).toContain('feat/a ↔ feat/b');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Bắt đầu/);
  });

  it('shows progress per step and a failed step by name', () => {
    const html = render({
      cleanup: { planRequestId: null, plan: plan(), error: null, run: { requestId: 'r1', done: null, events: [
        { type: 'fleetCleanupProgress', requestId: 'r1', step: 'backup', machine: 'danh', path: '/w/a', branch: 'feat/a', status: 'ok' },
        { type: 'fleetCleanupProgress', requestId: 'r1', step: 'tests', machine: 'danh', path: '/w/a', branch: 'feat/a', status: 'failed', detail: '3 specs đỏ' },
      ] } },
    });
    expect(html).toContain('3 specs đỏ');
    expect(html).toContain('Chạy test');
  });
});
