import { describe, expect, it } from 'vitest';

import type { ClientMessage, ProjectStoppedPageMessage, ProjectTreeNode, ServerMessage } from '../../core/src/messages.js';
import { createProjectStore, fetchStoppedPage } from '../src/company/projects/projectStore.js';
import { EMPTY_STOPPED_HISTORY, withStoppedPage } from '../src/company/projects/stoppedHistory.js';

const node = (id: string): ProjectTreeNode => ({ id, kind: 'session', name: id, sessionId: id });
const page = (requestId: string, ids: string[], extra: Partial<ProjectStoppedPageMessage> = {}): ProjectStoppedPageMessage =>
  ({ type: 'projectStoppedPage', requestId, ok: true, items: ids.map(node), total: 5, ...extra });

describe('withStoppedPage', () => {
  it('TC-STOPPED-01 replaces the list on a first page and appends on the next, dropping a repeat', () => {
    const first = withStoppedPage(EMPTY_STOPPED_HISTORY, page('r1', ['a', 'b'], { nextCursor: 'c1' }), true);
    expect(first.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(first.nextCursor).toBe('c1');
    const second = withStoppedPage(first, page('r2', ['b', 'c']), false);
    expect(second.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(second.nextCursor).toBeUndefined();
    expect(withStoppedPage(second, page('r3', ['z']), true).items.map((item) => item.id)).toEqual(['z']);
  });
});

describe('fetchStoppedPage', () => {
  it('TC-STOPPED-02 sends the cursor and query, and answers with the page', async () => {
    const sent: ClientMessage[] = [];
    const store = createProjectStore({ send: (message) => sent.push(message), newRequestId: () => 'p1' });
    const outcome = fetchStoppedPage(store, { cursor: '99|omp:x', query: 'web' });
    expect(sent[0]).toEqual({ type: 'projectStoppedRequest', requestId: 'p1', cursor: '99|omp:x', query: 'web' });
    store.accept(page('p1', ['a']) as ServerMessage);
    await expect(outcome).resolves.toMatchObject({ page: { items: [{ id: 'a' }], total: 5 } });
  });

  it('TC-STOPPED-03 reports the reason a refused page came with', async () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'p2' });
    const outcome = fetchStoppedPage(store, {});
    store.accept({ type: 'projectStoppedPage', requestId: 'p2', ok: false, reason: 'Con trỏ trang không hợp lệ.', items: [], total: 0 } as ServerMessage);
    await expect(outcome).resolves.toEqual({ refusal: 'Con trỏ trang không hợp lệ.' });
  });

  it('TC-STOPPED-04 reports a request the transport could not send, and says nothing for one a newer ask replaced', async () => {
    const broken = createProjectStore({ send: () => { throw new Error('Mất kết nối tới board.'); } });
    await expect(fetchStoppedPage(broken, {})).resolves.toEqual({ refusal: 'Mất kết nối tới board.' });

    const ids = ['o1', 'o2'];
    const store = createProjectStore({ send: () => undefined, newRequestId: () => ids.shift() ?? 'x' });
    const older = fetchStoppedPage(store, { query: 'a' });
    const newer = fetchStoppedPage(store, { query: 'a' });
    await expect(older).resolves.toEqual({ superseded: true });
    store.accept(page('o2', ['k']) as ServerMessage);
    await expect(newer).resolves.toMatchObject({ page: { items: [{ id: 'k' }] } });
  });

  it('TC-STOPPED-05 keeps two different queries apart: the newer one does not cancel the older', async () => {
    const ids = ['q1', 'q2'];
    const store = createProjectStore({ send: () => undefined, newRequestId: () => ids.shift() ?? 'x' });
    const a = fetchStoppedPage(store, { query: 'a' });
    const b = fetchStoppedPage(store, { query: 'b' });
    store.accept(page('q1', ['from-a']) as ServerMessage);
    store.accept(page('q2', ['from-b']) as ServerMessage);
    await expect(a).resolves.toMatchObject({ page: { items: [{ id: 'from-a' }] } });
    await expect(b).resolves.toMatchObject({ page: { items: [{ id: 'from-b' }] } });
  });
});
