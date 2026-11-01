import { describe, expect, it, vi } from 'vitest';

import type { HerdrAgentsMessage, HerdrScreenMessage } from '../../core/src/messages.js';
import { FLEET_TERMINAL_ID_BASE } from '../src/fleet/constants.js';
import { createShareTargets, SHARE_REASON_NO_TERMINAL, SHARE_REASON_NOT_CLOUD } from '../src/share/targets.js';

const CLOUD_ID = FLEET_TERMINAL_ID_BASE + 1;

function fakeHerdr(initialPanes: string[] = ['w1:p1']) {
  let panes = initialPanes;
  const screenListeners = new Set<(message: HerdrScreenMessage) => void>();
  const agentListeners = new Set<(message: HerdrAgentsMessage) => void>();
  const roster = (): HerdrAgentsMessage => ({
    type: 'herdrAgents',
    available: true,
    agents: panes.map((paneId) => ({ paneId, kind: 'omp', status: 'idle', workspaceId: 'w1' })),
    sleeping: [],
  });
  const link = {
    snapshot: roster,
    read: vi.fn(async (paneId: string) => ({ type: 'herdrScreen' as const, paneId, text: 'line one\nline two', at: 'now' })),
    watch: vi.fn(),
    onScreen: (listener: (message: HerdrScreenMessage) => void) => {
      screenListeners.add(listener);
      return () => screenListeners.delete(listener);
    },
    onAgents: (listener: (message: HerdrAgentsMessage) => void) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
  };
  return {
    link,
    screen: (paneId: string, text: string) => screenListeners.forEach((l) => l({ type: 'herdrScreen', paneId, text, at: 'now' })),
    setPanes: (next: string[]) => {
      panes = next;
      agentListeners.forEach((l) => l(roster()));
    },
    listeners: () => screenListeners.size + agentListeners.size,
  };
}

describe('createShareTargets: cloud terminals', () => {
  const ptyManager = { has: (id: number) => id === CLOUD_ID, get: (id: number) => (id === CLOUD_ID ? { marker: 'pty' } : undefined) };
  const targets = createShareTargets({ ptyManager: ptyManager as never });

  it('TC-SHARE-41 shares only a live cloud terminal, never a local shell', () => {
    expect(targets.refusal({ kind: 'cloud', terminalId: CLOUD_ID })).toBeNull();
    expect(targets.refusal({ kind: 'cloud', terminalId: 1 })).toBe(SHARE_REASON_NOT_CLOUD);
    expect(targets.refusal({ kind: 'cloud', terminalId: CLOUD_ID + 5 })).toBe(SHARE_REASON_NO_TERMINAL);
    expect(targets.feedFor({ kind: 'cloud', terminalId: CLOUD_ID })).toEqual({ marker: 'pty' });
    expect(targets.feedFor({ kind: 'cloud', terminalId: 1 })).toBeUndefined();
  });
});

describe('createShareTargets: board omp sessions', () => {
  it('TC-SHARE-42 shares a session that has a live terminal and refuses one that has none', () => {
    const peek = { cols: 120, rows: 32 };
    const targets = createShareTargets({ companyPeek: (id) => (id === 'live' ? (peek as never) : undefined) });
    expect(targets.refusal({ kind: 'company', sessionId: 'live' })).toBeNull();
    expect(targets.refusal({ kind: 'company', sessionId: 'gone' })).toBe(SHARE_REASON_NO_TERMINAL);
    expect(targets.feedFor({ kind: 'company', sessionId: 'live' })).toBe(peek);
  });

  it('TC-SHARE-43 refuses when this host offers no company terminals at all', () => {
    expect(createShareTargets({}).refusal({ kind: 'company', sessionId: 'x' })).toBe(SHARE_REASON_NO_TERMINAL);
  });
});

describe('createShareTargets: herdr panes', () => {
  it('TC-SHARE-44 shares a pane the roster lists and refuses an unknown or unlinked one', () => {
    const herdr = fakeHerdr();
    const targets = createShareTargets({ herdr: herdr.link as never });
    expect(targets.refusal({ kind: 'herdr', paneId: 'w1:p1' })).toBeNull();
    expect(targets.refusal({ kind: 'herdr', paneId: 'w9:p9' })).toBe(SHARE_REASON_NO_TERMINAL);
    expect(createShareTargets({}).refusal({ kind: 'herdr', paneId: 'w1:p1' })).toBe(SHARE_REASON_NO_TERMINAL);
  });

  it('TC-SHARE-45 the snapshot is the pane text as terminal lines, with a size that fits it', async () => {
    const herdr = fakeHerdr();
    herdr.link.read.mockResolvedValueOnce({ type: 'herdrScreen', paneId: 'w1:p1', text: `\x1b[32m${'x'.repeat(150)}\x1b[0m\nshort`, at: 'now' });
    const feed = createShareTargets({ herdr: herdr.link as never }).feedFor({ kind: 'herdr', paneId: 'w1:p1' });
    const snapshot = await feed?.snapshot();
    expect(snapshot).toBe(`\x1b[32m${'x'.repeat(150)}\x1b[0m\r\nshort`);
    expect(feed?.cols).toBeGreaterThanOrEqual(150);
    expect(feed?.rows).toBeGreaterThanOrEqual(2);
  });

  it('TC-SHARE-46 a screen change repaints from the top, for this pane only, and the watch is kept alive', () => {
    vi.useFakeTimers();
    try {
      const herdr = fakeHerdr();
      const feed = createShareTargets({ herdr: herdr.link as never }).feedFor({ kind: 'herdr', paneId: 'w1:p1' });
      const seen: string[] = [];
      const off = feed?.onData((chunk) => seen.push(chunk));
      expect(herdr.link.watch).toHaveBeenCalledWith('w1:p1', true);
      herdr.screen('w1:p1', 'a\nb');
      herdr.screen('w2:p2', 'other pane');
      expect(seen).toEqual(['\x1b[2J\x1b[3J\x1b[Ha\r\nb']);
      const watches = herdr.link.watch.mock.calls.length;
      vi.advanceTimersByTime(25_000);
      expect(herdr.link.watch.mock.calls.length).toBeGreaterThan(watches);
      off?.();
      const after = herdr.link.watch.mock.calls.length;
      vi.advanceTimersByTime(60_000);
      expect(herdr.link.watch.mock.calls.length).toBe(after);
      expect(herdr.listeners()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-SHARE-52 sends at most one repaint per half second, always ending on the newest screen', () => {
    vi.useFakeTimers();
    try {
      const herdr = fakeHerdr();
      const feed = createShareTargets({ herdr: herdr.link as never }).feedFor({ kind: 'herdr', paneId: 'w1:p1' });
      const seen: string[] = [];
      const off = feed?.onData((chunk) => seen.push(chunk));
      for (const text of ['one', 'two', 'three', 'four']) herdr.screen('w1:p1', text);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('one');
      vi.advanceTimersByTime(500);
      expect(seen).toHaveLength(2);
      expect(seen[1]).toContain('four');
      vi.advanceTimersByTime(2000);
      expect(seen).toHaveLength(2);
      off?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-SHARE-53 drops a repaint that was waiting when the viewer leaves', () => {
    vi.useFakeTimers();
    try {
      const herdr = fakeHerdr();
      const feed = createShareTargets({ herdr: herdr.link as never }).feedFor({ kind: 'herdr', paneId: 'w1:p1' });
      const seen: string[] = [];
      const off = feed?.onData((chunk) => seen.push(chunk));
      herdr.screen('w1:p1', 'one');
      herdr.screen('w1:p1', 'two');
      off?.();
      vi.advanceTimersByTime(5000);
      expect(seen).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-SHARE-47 reports an exit once the pane leaves the roster', () => {
    const herdr = fakeHerdr();
    const feed = createShareTargets({ herdr: herdr.link as never }).feedFor({ kind: 'herdr', paneId: 'w1:p1' });
    const exits: number[] = [];
    feed?.onExit((exit) => exits.push(exit.exitCode));
    herdr.setPanes(['w1:p1', 'w1:p2']);
    expect(exits).toEqual([]);
    herdr.setPanes(['w1:p2']);
    expect(exits).toEqual([0]);
  });
});
