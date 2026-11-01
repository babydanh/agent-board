import { describe, expect, it } from 'vitest';

import { RunnerTerminalGateway } from '../src/company/companyTerminalGateway.js';

const SESSION = 'session-1';
const EPOCH = 2;

/** A gateway over a PTY whose framebuffer is `screen` (raw text, base64 on the wire like the helper's). */
function gateway(screen: () => string): RunnerTerminalGateway {
  return new RunnerTerminalGateway({
    client: {
      write: async () => undefined,
      resize: async () => undefined,
      snapshot: async () => Buffer.from(screen(), 'utf8').toString('base64'),
    },
    isLive: () => true,
    size: () => ({ cols: 120, rows: 32 }),
  });
}

const decode = (base64: string): string => Buffer.from(base64, 'base64').toString('utf8');

describe('RunnerTerminalGateway', () => {
  it('replays the framebuffer on attach, newer than every frame sent before it', async () => {
    const screen = '\x1b[31mred\x1b[0m line\r\nsecond line\r\n';
    const terminal = gateway(() => screen);
    terminal.nextSeq(SESSION, EPOCH);
    terminal.nextSeq(SESSION, EPOCH);

    const handle = await terminal.attach(SESSION, EPOCH);

    expect(handle.replay?.seq).toBe(3);
    expect(decode(handle.replay?.data ?? '')).toBe(screen);
    expect(terminal.nextSeq(SESSION, EPOCH)).toBe(4);
  });

  it('keeps counting across a detach, so a reattached viewer accepts the new replay', async () => {
    const terminal = gateway(() => 'screen\r\n');
    const first = await terminal.attach(SESSION, EPOCH);
    const lastSeen = terminal.nextSeq(SESSION, EPOCH);
    await terminal.detach(SESSION, EPOCH, first.leaseId);
    terminal.nextSeq(SESSION, EPOCH); // output while nobody watches

    const second = await terminal.attach(SESSION, EPOCH);

    expect(second.replay?.seq).toBeGreaterThan(lastSeen);
  });

  it('replays only the newest lines of a large framebuffer, from a line start', async () => {
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `\x1b[32mline ${i}\x1b[0m ${'x'.repeat(20)}`,
    );
    const terminal = gateway(() => lines.join('\r\n'));

    const replayed = decode((await terminal.attach(SESSION, EPOCH)).replay?.data ?? '');

    expect(Buffer.byteLength(replayed, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(replayed.startsWith('\x1b[32mline ')).toBe(true);
    expect(replayed.endsWith(lines.at(-1) ?? '')).toBe(true);
  });

  describe('peek (read-only view for a share link)', () => {
    type Listener = (event: { type: string; sessionId: string; data?: string; exitCode?: number }) => void;

    function peekable(screen: string, live: number | null = EPOCH) {
      const listeners = new Set<Listener>();
      const writes: string[] = [];
      const terminal = new RunnerTerminalGateway({
        client: {
          write: async (_id, data) => void writes.push(data),
          resize: async () => undefined,
          snapshot: async () => Buffer.from(screen, 'utf8').toString('base64'),
        },
        isLive: () => true,
        size: () => ({ cols: 120, rows: 32 }),
        liveEpoch: () => live ?? undefined,
        events: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });
      const emit: Listener = (event) => listeners.forEach((listener) => listener(event));
      return { terminal, emit, writes, listeners };
    }

    it('TC-SHARE-36 gives the screen as text without taking the viewer lease or sending anything', async () => {
      const { terminal, writes } = peekable('hello\r\nworld');
      const peek = terminal.peek(SESSION);
      expect(peek).toMatchObject({ cols: 120, rows: 32 });
      expect(await peek?.snapshot()).toBe('hello\r\nworld');
      expect(terminal.hasViewer(SESSION, EPOCH)).toBe(false);
      expect(writes).toEqual([]);
    });

    it('TC-SHARE-37 is absent when the session has no live run', () => {
      expect(peekable('x', null).terminal.peek(SESSION)).toBeUndefined();
    });

    it('TC-SHARE-38 relays only the output of this run, decoded, and stops after unsubscribe', () => {
      const { terminal, emit, listeners } = peekable('x');
      const seen: string[] = [];
      const off = terminal.peek(SESSION)?.onData((chunk) => seen.push(chunk));
      const key = `${SESSION}:${EPOCH}`;
      emit({ type: 'data', sessionId: key, data: Buffer.from('héllo', 'utf8').toString('base64') });
      emit({ type: 'data', sessionId: 'other:1', data: Buffer.from('nope', 'utf8').toString('base64') });
      expect(seen).toEqual(['héllo']);
      off?.();
      expect(listeners.size).toBe(0);
    });

    it('TC-SHARE-39 keeps a multi-byte character split across two chunks whole', () => {
      const { terminal, emit } = peekable('x');
      const seen: string[] = [];
      terminal.peek(SESSION)?.onData((chunk) => seen.push(chunk));
      const bytes = Buffer.from('€', 'utf8');
      const key = `${SESSION}:${EPOCH}`;
      emit({ type: 'data', sessionId: key, data: bytes.subarray(0, 1).toString('base64') });
      emit({ type: 'data', sessionId: key, data: bytes.subarray(1).toString('base64') });
      expect(seen.join('')).toBe('€');
    });

    it('TC-SHARE-40 reports the exit of this run', () => {
      const { terminal, emit } = peekable('x');
      const exits: number[] = [];
      terminal.peek(SESSION)?.onExit((exit) => exits.push(exit.exitCode));
      emit({ type: 'exit', sessionId: `${SESSION}:${EPOCH}`, exitCode: 7 });
      expect(exits).toEqual([7]);
    });
  });
});
