import { describe, expect, it } from 'vitest';

import type { ClientMessage } from '../../core/src/messages.js';
import {
  CLOUD_TERMINAL_REOPEN_COOLDOWN_MS,
  reopenOnce,
  shouldReopenAfterExit,
  shouldReopenTerminal,
} from '../src/company/fleet/cloudTerminalReopen.js';
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

describe('shouldReopenAfterExit (TC-CLOUDTERM-03)', () => {
  it('reopens when ssh lost its connection (255): the instabox gateway cut it, tmux and the agent still run', () => {
    expect(shouldReopenAfterExit({ exitCode: 255, lastReopenAt: null, now: 100_000 })).toBe(true);
  });

  it('does not reopen when the reader left tmux (0) or the tmux session is gone (1)', () => {
    expect(shouldReopenAfterExit({ exitCode: 0, lastReopenAt: null, now: 100_000 })).toBe(false);
    expect(shouldReopenAfterExit({ exitCode: 1, lastReopenAt: null, now: 100_000 })).toBe(false);
  });

  it('waits out the cooldown, so a machine ssh cannot reach is not dialled in a loop', () => {
    const now = 100_000;
    expect(shouldReopenAfterExit({ exitCode: 255, lastReopenAt: now - CLOUD_TERMINAL_REOPEN_COOLDOWN_MS + 1, now })).toBe(false);
    expect(shouldReopenAfterExit({ exitCode: 255, lastReopenAt: now - CLOUD_TERMINAL_REOPEN_COOLDOWN_MS, now })).toBe(true);
  });
});

describe('reopenOnce (TC-CLOUDTERM-04)', () => {
  const lostSsh = (now: number) => (lastReopenAt: number | null) =>
    shouldReopenAfterExit({ exitCode: 255, lastReopenAt, now });

  it('reopens, then refuses a second drop within the cooldown even though every reopen mounts a new view', () => {
    let reopened = 0;
    const reopen = () => reopened++;
    expect(reopenOnce(41, 100_000, lostSsh(100_000), reopen)).toBe(true);
    // The next view of the same session starts with nothing of its own: the refusal must come from the shared time.
    expect(reopenOnce(41, 105_000, lostSsh(105_000), reopen)).toBe(false);
    expect(reopened).toBe(1);
    expect(reopenOnce(41, 100_000 + CLOUD_TERMINAL_REOPEN_COOLDOWN_MS, lostSsh(100_000 + CLOUD_TERMINAL_REOPEN_COOLDOWN_MS), reopen)).toBe(true);
    expect(reopened).toBe(2);
  });

  it('keeps the cooldown per terminal, so one dying session does not block another', () => {
    let reopened = 0;
    const reopen = () => reopened++;
    expect(reopenOnce(42, 200_000, lostSsh(200_000), reopen)).toBe(true);
    expect(reopenOnce(43, 200_500, lostSsh(200_500), reopen)).toBe(true);
    expect(reopened).toBe(2);
  });

  it('does nothing and keeps no time when the view cannot reopen', () => {
    let reopened = 0;
    expect(reopenOnce(44, 300_000, lostSsh(300_000), undefined)).toBe(false);
    expect(reopenOnce(44, 300_001, lostSsh(300_001), () => reopened++)).toBe(true);
    expect(reopened).toBe(1);
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
