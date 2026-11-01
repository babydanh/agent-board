import { describe, expect, it } from 'vitest';

import type { ClientMessage, ServerMessage, ShareInfo } from '../../core/src/messages.js';
import { isLoopbackHostname, shareUrl } from '../src/company/share/shareLink.js';
import { createShareStore } from '../src/company/share/shareStore.js';

const info = (token: string): ShareInfo => ({ token, kind: 'cloud', label: 'danh', createdAt: 1, expiresAt: 2 });
const cloud = (terminalId: number) => ({ kind: 'cloud' as const, terminalId });
const result = (requestId: string, extra: Record<string, unknown> = {}): ServerMessage =>
  ({ type: 'shareResult', requestId, ok: true, shares: [], ...extra }) as ServerMessage;

function setup() {
  const sent: ClientMessage[] = [];
  let counter = 0;
  const store = createShareStore({ send: (message) => sent.push(message), newRequestId: () => `r${++counter}` });
  return { store, sent };
}

describe('shareStore', () => {
  it('TC-SHARE-27 sends shareCreate, waits for the answer, and keeps the new token and the list', () => {
    const { store, sent } = setup();
    store.create({ target: cloud(900_000_001), label: 'danh', ttlMinutes: 60 });
    expect(sent[0]).toEqual({ type: 'shareCreate', requestId: 'r1', kind: 'cloud', terminalId: 900_000_001, label: 'danh', ttlMinutes: 60 });
    expect(store.getSnapshot().busy).toBe(true);
    store.accept(result('r1', { token: 'tok', shares: [info('tok')] }));
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: null, createdToken: 'tok', shares: [{ token: 'tok' }] });
  });

  it('TC-SHARE-28 shows the reason of a refusal and still updates the list', () => {
    const { store } = setup();
    store.create({ target: cloud(1), label: 'x' });
    store.accept(result('r1', { ok: false, reason: 'Đã có 20 link', shares: [info('a')] }));
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: 'Đã có 20 link', createdToken: null, shares: [{ token: 'a' }] });
  });

  it('TC-SHARE-29 ignores an answer to a request that is no longer the latest', () => {
    const { store } = setup();
    store.create({ target: cloud(1), label: 'x' });
    store.refresh();
    store.accept(result('r1', { token: 'stale', shares: [info('stale')] }));
    expect(store.getSnapshot()).toMatchObject({ busy: true, createdToken: null, shares: [] });
  });

  it('TC-SHARE-49 sends a board omp session and a herdr pane as their own kind with only their own id', () => {
    const { store, sent } = setup();
    store.create({ target: { kind: 'company', sessionId: 's-1' }, label: 'a' });
    store.create({ target: { kind: 'herdr', paneId: 'w1:p2' }, label: 'b' });
    expect(sent).toEqual([
      { type: 'shareCreate', requestId: 'r1', kind: 'company', sessionId: 's-1', label: 'a' },
      { type: 'shareCreate', requestId: 'r2', kind: 'herdr', paneId: 'w1:p2', label: 'b' },
    ]);
  });

  it('TC-SHARE-30 revokes by token and refreshes by asking for the list', () => {
    const { store, sent } = setup();
    store.revoke('tok');
    store.refresh();
    expect(sent).toEqual([
      { type: 'shareRevoke', requestId: 'r1', token: 'tok' },
      { type: 'shareListRequest', requestId: 'r2' },
    ]);
  });

  it('TC-SHARE-31 a send that throws leaves the store free with an error instead of busy forever', () => {
    const store = createShareStore({ send: () => { throw new Error('closed'); }, newRequestId: () => 'r1' });
    store.create({ target: cloud(1), label: 'x' });
    expect(store.getSnapshot().busy).toBe(false);
    expect(store.getSnapshot().error).toEqual(expect.any(String));
  });

  it('TC-SHARE-32 reset clears the last created link and error but keeps the list', () => {
    const { store } = setup();
    store.create({ target: cloud(1), label: 'x' });
    store.accept(result('r1', { token: 'tok', shares: [info('tok')] }));
    store.reset();
    expect(store.getSnapshot()).toMatchObject({ createdToken: null, error: null, shares: [{ token: 'tok' }] });
  });
});

describe('shareLink', () => {
  it('TC-SHARE-33 builds the link from the page origin and encodes the token', () => {
    expect(shareUrl('https://pc.tail1234.ts.net', 'ab_c-D')).toBe('https://pc.tail1234.ts.net/share/ab_c-D');
    expect(shareUrl('http://127.0.0.1:3200', 'a/b')).toBe('http://127.0.0.1:3200/share/a%2Fb');
  });

  it('TC-SHARE-34 knows which hostnames only this machine can open', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', '127.1.2.3', 'LOCALHOST']) expect(isLoopbackHostname(host)).toBe(true);
    for (const host of ['pc.tail1234.ts.net', '100.64.1.2', '192.168.1.5']) expect(isLoopbackHostname(host)).toBe(false);
  });
});
