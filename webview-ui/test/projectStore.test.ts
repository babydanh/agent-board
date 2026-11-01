import { describe, expect, it } from 'vitest';

import type { ClientMessage, ServerMessage } from '../../core/src/messages.js';
import { createProjectStore, waitForProjectCreate, waitForProjectWake } from '../src/company/projects/projectStore.js';

const snapshot = (requestId: string, name: string, partial = false): ServerMessage =>
  ({
    type: 'projectTreeSnapshot',
    requestId,
    nodes: [{ id: name, kind: 'project', name }],
    ...(partial ? { partial: true } : {}),
  }) as ServerMessage;

describe('project store tree snapshots', () => {
  it('takes the quick and the full snapshot of one request, and later pushes the server sends unasked', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'r1' });
    store.requestTree();
    store.accept(snapshot('r1', 'quick', true));
    expect(store.getSnapshot().treeComplete).toBe(false);
    store.accept(snapshot('r1', 'full'));
    expect(store.getSnapshot().nodes.map((node) => node.name)).toEqual(['full']);
    expect(store.getSnapshot().treeComplete).toBe(true);
    expect(store.getSnapshot().pending).toEqual({});
    store.accept(snapshot('project-tree-refresh', 'refreshed'));
    expect(store.getSnapshot().nodes.map((node) => node.name)).toEqual(['refreshed']);
  });

  it('keeps the full tree when a quick snapshot arrives after it, so repos never blink away', () => {
    const store = createProjectStore({ send: () => undefined });
    store.accept(snapshot('a', 'full'));
    store.accept(snapshot('b', 'quick', true));
    expect(store.getSnapshot().nodes.map((node) => node.name)).toEqual(['full']);
    expect(store.getSnapshot().treeComplete).toBe(true);
  });
});

describe('project store delete', () => {
  const tree = (): ServerMessage => ({
    type: 'projectTreeSnapshot',
    requestId: 'tree',
    nodes: [
      { id: 'p1', kind: 'project', name: 'Một' },
      { id: 'f1', kind: 'folder', name: 'thư mục', parentId: 'p1' },
      { id: 'p2', kind: 'project', name: 'Hai' },
    ],
  }) as ServerMessage;
  const deleted = (requestId: string, nodeId: string): ServerMessage =>
    ({ type: 'projectCommandResult', requestId, command: 'delete', ok: true, nodeId }) as ServerMessage;

  it('drops the node and its descendants as soon as the server confirms, before any tree snapshot', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'd1' });
    store.accept(tree());
    store.deleteNode('p1');
    store.accept(deleted('d1', 'p1'));
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual(['p2']);
  });

  it('keeps the node and shows the reason when the delete is refused', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'd1' });
    store.accept(tree());
    store.deleteNode('p1');
    store.accept({ type: 'projectCommandResult', requestId: 'd1', command: 'delete', ok: false, nodeId: 'p1', reason: 'Không thể xóa nút Project.' } as ServerMessage);
    expect(store.getSnapshot().nodes).toHaveLength(3);
    expect(store.getSnapshot().errors['command:delete:p1']).toBe('Không thể xóa nút Project.');
  });
});

describe('project store branch comparison', () => {
  it('sends comparisons, replaces the latest identical request and stores the matching result', () => {
    const sent: ClientMessage[] = [];
    let nextId = 0;
    const store = createProjectStore({
      send: (message) => sent.push(message),
      newRequestId: () => `compare-${++nextId}`,
    });
    const input = { repo: '/repo', branchA: 'feature-a', branchB: 'feature-b' };

    store.requestBranchCompare(input);
    store.requestBranchCompare(input);

    expect(sent).toEqual([
      { ...input, type: 'projectBranchCompareRequest', requestId: 'compare-1' },
      { ...input, type: 'projectBranchCompareRequest', requestId: 'compare-2' },
    ]);
    expect(Object.keys(store.getSnapshot().pending)).toEqual(['compare-2']);
    const result: ServerMessage = {
      type: 'projectBranchCompare',
      requestId: 'compare-2',
      ...input,
      a: { branch: 'feature-a', head: 'a', lastCommitAt: null, lastCommitSubject: null, dirtyFiles: [] },
      b: { branch: 'feature-b', head: 'b', lastCommitAt: null, lastCommitSubject: null, dirtyFiles: [] },
      mergeBase: null,
      onlyA: [],
      onlyB: [],
      commitsTruncated: false,
      files: [],
      mergeClean: true,
      conflicts: [],
    };
    store.accept(result);
    expect(store.getSnapshot().results['compare-2']).toEqual(result);
    expect(store.getSnapshot().pending).toEqual({});
  });
});

describe('waiting for a create', () => {
  const result = (requestId: string, ok: boolean, extra: object = {}) =>
    ({ type: 'projectCommandResult', requestId, command: 'create', ok, ...extra }) as ServerMessage;

  it('answers with the new node id, or the reason the server refused it', async () => {
    const ids = ['c1', 'c2'];
    const store = createProjectStore({ send: () => undefined, newRequestId: () => ids.shift() ?? 'x' });
    const made = waitForProjectCreate(store, store.createNode({ kind: 'folder', parentId: 'p', name: 'a', path: 'D:/a' }));
    store.accept(result('c1', true, { nodeId: 'folder-1' }));
    await expect(made).resolves.toEqual({ nodeId: 'folder-1' });

    const refused = waitForProjectCreate(store, store.createNode({ kind: 'folder', parentId: 'p', name: 'a', path: 'D:/a' }));
    store.accept(result('c2', false, { reason: 'Thư mục này đã có trong cây Project.' }));
    await expect(refused).resolves.toEqual({ refusal: 'Thư mục này đã có trong cây Project.' });
  });

  it('says nothing for a create a newer one replaced, and the newer one reports', async () => {
    const ids = ['old', 'new'];
    const store = createProjectStore({ send: () => undefined, newRequestId: () => ids.shift() ?? 'x' });
    const older = waitForProjectCreate(store, store.createNode({ kind: 'project', name: 'A', path: 'D:/a' }));
    const newer = waitForProjectCreate(store, store.createNode({ kind: 'project', name: 'B', path: 'D:/b' }));
    await expect(older).resolves.toEqual({ superseded: true });
    store.accept(result('new', true, { nodeId: 'project-b' }));
    await expect(newer).resolves.toEqual({ nodeId: 'project-b' });
  });

  it('reports a create the transport could not send', async () => {
    const store = createProjectStore({ send: () => { throw new Error('Mất kết nối tới board.'); } });
    await expect(waitForProjectCreate(store, store.createNode({ kind: 'project', name: 'A', path: 'D:/a' }))).resolves.toEqual({ refusal: 'Mất kết nối tới board.' });
  });
});

describe('waiting for a wake', () => {
  it('answers with the pane the woken session runs in, or the reason the server refused it', async () => {
    const sent: ClientMessage[] = [];
    const ids = ['w1', 'w2'];
    const store = createProjectStore({ send: (message) => sent.push(message), newRequestId: () => ids.shift() ?? 'x' });
    const woken = waitForProjectWake(store, store.wakeSession('s-1', 'làm tiếp'), 's-1');
    expect(sent[0]).toEqual({ type: 'projectSessionWake', requestId: 'w1', sessionId: 's-1', prompt: 'làm tiếp' });
    store.accept({ type: 'projectCommandResult', requestId: 'w1', command: 'wake', ok: true, paneId: 'p_9' } as ServerMessage);
    await expect(woken).resolves.toEqual({ target: { paneId: 'p_9' } });

    const refused = waitForProjectWake(store, store.wakeSession('s-2', ''), 's-2');
    expect(sent[1]).not.toHaveProperty('prompt');
    store.accept({ type: 'projectCommandResult', requestId: 'w2', command: 'wake', ok: false, reason: 'Phiên này vẫn đang chạy.' } as ServerMessage);
    await expect(refused).resolves.toEqual({ refusal: 'Phiên này vẫn đang chạy.' });
  });

  it('names the board chat an omp session reopened as, in its board folder', async () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'w3' });
    const woken = waitForProjectWake(store, store.wakeSession('s-3', ''), 's-3');
    store.accept({ type: 'projectCommandResult', requestId: 'w3', command: 'wake', ok: true, boardSessionId: 'board-1', folder: 'V:/f' } as ServerMessage);
    await expect(woken).resolves.toEqual({ target: { boardSessionId: 'board-1', folder: 'V:/f' } });
  });
});

describe('project store session progress', () => {
  const progress = (requestId: string, stage: 'worktree' | 'setup' | 'launch'): ServerMessage =>
    ({ type: 'projectSessionProgress', requestId, stage }) as ServerMessage;

  it('TC-STARTLOG-06 keeps the stages of a pending start, drops them once it is answered, and ignores strangers', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'r1' });
    store.startSession({ nodeId: 'n', engine: 'claude', worktree: 'separate', taskName: 't', initialPrompt: '' });
    store.accept(progress('other', 'worktree'));
    expect(store.getSnapshot().progress).toEqual({});
    store.accept(progress('r1', 'worktree'));
    store.accept(progress('r1', 'launch'));
    expect(store.getSnapshot().progress).toEqual({ r1: ['worktree', 'launch'] });
    store.accept({ type: 'projectSessionStartResult', requestId: 'r1', ok: true, sessionId: 's', checkout: '/c' } as ServerMessage);
    expect(store.getSnapshot().progress).toEqual({});
  });

  it('TC-STARTLOG-10 forgets the stages of a start that a newer start replaced', () => {
    let next = 0;
    const store = createProjectStore({ send: () => undefined, newRequestId: () => `r${++next}` });
    const start = () => store.startSession({ nodeId: 'n', engine: 'claude', worktree: 'separate', taskName: 't', initialPrompt: '' });
    start();
    store.accept(progress('r1', 'worktree'));
    start();
    expect(store.getSnapshot().progress).toEqual({});
  });
});
