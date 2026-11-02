import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ClientMessage, FleetCommandRow, ServerMessage } from '../../core/src/messages.js';
import { createFleetStore } from '../src/company/fleet/fleetStore.js';
import { FleetCommandHistory } from '../src/company/fleet/FleetView.js';

// FleetView pulls in the app transport, which needs a browser window at import time; these tests only render a list.
vi.mock('../src/company/fleet/fleetClient.js', () => ({ fleetStore: {} }));

const row = (over: Partial<FleetCommandRow> = {}): FleetCommandRow => ({
  id: 'a', machine: 'danh', verb: 'snapshot-push', state: 'queued', createdAt: 1, ...over,
});

describe('fleet command store', () => {
  it('TC-CMDUI-01: queues one fixed command, then asks for the history once the hub accepted it', () => {
    const sent: ClientMessage[] = [];
    let n = 0;
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => `r${++n}` });
    store.queueCommand({ machine: 'danh', verb: 'clean-worktree', path: '/data/home/wt', branch: 'feat/a' });
    expect(sent).toEqual([{ type: 'fleetCommandQueue', requestId: 'r1', machine: 'danh', verb: 'clean-worktree', path: '/data/home/wt', branch: 'feat/a' }]);
    expect(store.getSnapshot().action).toMatchObject({ kind: 'command', machine: 'danh' });
    store.accept({ type: 'fleetCommandResult', requestId: 'r1', ok: true, code: 'success' } as ServerMessage);
    expect(sent[1]).toEqual({ type: 'fleetCommandHistoryRequest', requestId: 'r2' });
  });

  it('TC-CMDUI-02: a refused command keeps the reason (it may carry the public key to register) and asks for nothing more', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => 'r1' });
    store.queueCommand({ machine: 'danh', verb: 'snapshot-push', path: '/p' });
    store.accept({ type: 'fleetCommandResult', requestId: 'r1', ok: false, code: 'failed', reason: 'Khoá lệnh chưa đăng ký: BEGIN PUBLIC KEY' } as ServerMessage);
    expect(store.getSnapshot().actionError).toContain('BEGIN PUBLIC KEY');
    expect(store.getSnapshot().action).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('TC-CMDUI-03: the history answer replaces the list; an answer nobody asked for is ignored', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (m) => sent.push(m), newRequestId: () => 'r1' });
    store.requestCommands();
    expect(sent).toEqual([{ type: 'fleetCommandHistoryRequest', requestId: 'r1' }]);
    store.accept({ type: 'fleetCommandHistory', requestId: 'other', commands: [row({ id: 'x' })] } as ServerMessage);
    expect(store.getSnapshot().commands).toBeNull();
    store.accept({ type: 'fleetCommandHistory', requestId: 'r1', commands: [row()] } as ServerMessage);
    expect(store.getSnapshot().commands).toEqual([row()]);
    expect(store.getSnapshot().action).toBeNull();
  });
});

describe('fleet command history view', () => {
  const render = (commands: readonly FleetCommandRow[] | null): string => renderToStaticMarkup(createElement(FleetCommandHistory, { commands }));

  it('TC-CMDUI-04: every row shows verb, machine, state and the machine answer', () => {
    const html = render([
      row({ id: 'a', state: 'success', verb: 'clean-worktree', path: '/data/home/wt', detail: 'removed /data/home/wt' }),
      row({ id: 'b', machine: 'danh1', state: 'refused', detail: 'branch is protected' }),
      row({ id: 'c', machine: 'danh2', state: 'queued' }),
    ]);
    for (const text of ['clean-worktree', 'danh1', 'Thành công', 'Bị từ chối', 'Đang chờ', 'removed /data/home/wt', 'branch is protected']) expect(html).toContain(text);
  });

  it('TC-CMDUI-05: nothing loaded yet says so, and an empty history says there are no commands', () => {
    expect(render(null)).toContain('Chưa tải');
    expect(render([])).toContain('Chưa có lệnh');
  });
});
