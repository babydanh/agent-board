import { describe, expect, it } from 'vitest';

import type { ClientMessage } from '../../core/src/messages.js';
import { CLOUD_TERMINAL_REOPEN_COOLDOWN_MS, shouldReopenTerminal } from '../src/company/fleet/cloudTerminalReopen.js';
import { createFleetStore } from '../src/company/fleet/fleetStore.js';

const GONE = 4004;

describe('shouldReopenTerminal (TC-CLOUDTERM-01)', () => {
  it('reopens when the board no longer has the terminal (4004) and nothing was reopened lately', () => {
    expect(shouldReopenTerminal({ code: GONE, lastReopenAt: null, now: 100_000 })).toBe(true);
  });

  it('does not reopen for any other close code, so a dropped network is not mistaken for a gone terminal', () => {
    expect(shouldReopenTerminal({ code: 1006, lastReopenAt: null, now: 100_000 })).toBe(false);
    expect(shouldReopenTerminal({ code: 1000, lastReopenAt: null, now: 100_000 })).toBe(false);
  });

  it('waits out the cooldown, so a terminal that dies at once cannot reopen in a loop', () => {
    const now = 100_000;
    expect(shouldReopenTerminal({ code: GONE, lastReopenAt: now - CLOUD_TERMINAL_REOPEN_COOLDOWN_MS + 1, now })).toBe(false);
    expect(shouldReopenTerminal({ code: GONE, lastReopenAt: now - CLOUD_TERMINAL_REOPEN_COOLDOWN_MS, now })).toBe(true);
  });
});

describe('fleetStore.reopenTerminal (TC-CLOUDTERM-02)', () => {
  function attachedStore() {
    const sent: ClientMessage[] = [];
    const queue = ['t1', 't2'];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => queue.shift() ?? 'x' });
    store.openTerminal('danh', 'heloo-74pr');
    store.accept({ type: 'fleetTerminalOpened', requestId: 't1', terminalId: 7 });
    return { store, sent };
  }

  it('drops the dead terminal and asks the board for a new one on the same machine and session', () => {
    const { store, sent } = attachedStore();
    expect(store.getSnapshot().terminal?.terminalId).toBe(7);

    store.reopenTerminal();

    expect(store.getSnapshot().terminal).toBeNull();
    expect(sent.at(-1)).toMatchObject({ type: 'fleetTerminalOpen', machine: 'danh', session: 'heloo-74pr' });
    expect(store.getSnapshot().action?.kind).toBe('terminal');
  });

  it('keeps the terminal while another action holds the lock, instead of dropping it with nothing to reopen it', () => {
    const { store, sent } = attachedStore();
    store.wakeMachine('danh');
    const before = sent.length;

    store.reopenTerminal();

    expect(store.getSnapshot().terminal?.terminalId).toBe(7);
    expect(sent).toHaveLength(before);
  });

  it('does nothing when no terminal is attached', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'x' });

    store.reopenTerminal();

    expect(sent).toEqual([]);
  });
});
