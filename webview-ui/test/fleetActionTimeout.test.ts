import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientMessage } from '../../core/src/messages.js';
import { busyView } from '../src/company/components/busyView.js';
import { FLEET_ACTION_TIMEOUT_MS } from '../src/company/constants.js';
import { createFleetStore } from '../src/company/fleet/fleetStore.js';

function storeWith(ids: string[] = ['a1', 'a2', 'a3']) {
  const sent: ClientMessage[] = [];
  const queue = [...ids];
  const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => queue.shift() ?? 'x' });
  return { store, sent };
}

describe('fleet action timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('records when an action started', () => {
    const { store } = storeWith();
    store.wakeMachine('danh');
    expect(store.getSnapshot().action?.startedAt).toBe(1_000_000);
  });

  it('frees the buttons with a retry message when the server never answers', () => {
    const { store } = storeWith();
    store.cleanTask('danh', 'viec-1');
    vi.advanceTimersByTime(FLEET_ACTION_TIMEOUT_MS.clean - 1);
    expect(store.getSnapshot().action).not.toBeNull();

    vi.advanceTimersByTime(1);

    const state = store.getSnapshot();
    expect(state.action).toBeNull();
    expect(state.actionError).toContain('chưa trả lời');
  });

  it('does not expire an action that was answered in time', () => {
    const { store } = storeWith();
    store.wakeMachine('danh');
    store.accept({ type: 'fleetCommandResult', requestId: 'a1', ok: true } as never);
    vi.advanceTimersByTime(FLEET_ACTION_TIMEOUT_MS.wake - 50_000);
    store.cleanTask('danh', 'viec-1'); // a second action must not inherit the first one's timer
    const second = store.getSnapshot().action?.requestId;
    expect(second).toBeDefined();

    vi.advanceTimersByTime(60_000); // past the wake deadline, well inside the clean deadline

    expect(store.getSnapshot().action?.requestId).toBe(second);
  });

  it('lets the user stop waiting, ignores the late answer, and allows a new action', () => {
    const { store } = storeWith();
    store.createTask({ machine: 'danh', repo: 'all', slug: 'viec', prompt: 'p', engine: 'claude' });
    store.cancelAction();
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().actionError).toBeNull();

    store.accept({ type: 'fleetTaskCreated', requestId: 'a1', machine: 'danh', session: 'viec' } as never);
    expect(store.getSnapshot().createdTask).toBeNull();

    store.wakeMachine('danh');
    expect(store.getSnapshot().action?.kind).toBe('wake');
  });
});

describe('busyView', () => {
  it('counts whole seconds and marks a wait slow only after the threshold', () => {
    expect(busyView(1_000_000, 1_004_900, 20_000)).toEqual({ seconds: 4, slow: false });
    expect(busyView(1_000_000, 1_020_000, 20_000)).toEqual({ seconds: 20, slow: true });
  });

  it('never shows a negative time when the clock steps back', () => {
    expect(busyView(2_000_000, 1_000_000, 20_000)).toEqual({ seconds: 0, slow: false });
  });
});
