import { describe, expect, it } from 'vitest';

import type { ClientMessage, FleetPullRequest, ServerMessage } from '../../core/src/messages.js';
import { createFleetStore } from '../src/company/fleet/fleetStore.js';

const failedPullRequest: FleetPullRequest = {
  number: 42,
  state: 'open',
  isDraft: false,
  reviewDecision: null,
  url: 'https://github.com/org/repo/pull/42',
  ci: 'red',
  failedChecks: ['lint', 'typecheck'],
};

describe('fleet comment actions', () => {
  it('sends cloud comments as bounded structured requests and clears successful actions', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'r1' });
    const comment = {
      machine: 'cloud-a',
      path: '/data/home/wt/repo-task',
      session: 'repo-task',
      branch: 'cloud/repo-task',
      file: 'src/a.ts',
      line: 12,
      snippet: '+const broken = true;',
      content: 'Please fix this line.',
    };

    store.sendCloudComment(comment);

    expect(sent).toEqual([{ type: 'fleetCloudCommentSend', requestId: 'r1', ...comment }]);
    expect(store.getSnapshot().action).toMatchObject({ kind: 'comment', machine: 'cloud-a', session: 'repo-task' });
    store.accept({ type: 'fleetCommandResult', requestId: 'r1', ok: true, code: 'success' } as ServerMessage);
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().actionError).toBeNull();
  });

  it('runs a local branch action and refreshes PR status after success', () => {
    let requestIndex = 0;
    const sent: ClientMessage[] = [];
    const store = createFleetStore({
      send: (message) => sent.push(message),
      newRequestId: () => `branch-${++requestIndex}`,
    });

    store.runBranchAction({ action: 'push', checkout: 'C:/repo/.worktrees/task', branch: 'feature/task' });
    expect(sent[0]).toEqual({
      type: 'fleetBranchAction',
      requestId: 'branch-1',
      action: 'push',
      checkout: 'C:/repo/.worktrees/task',
      branch: 'feature/task',
    });
    expect(store.getSnapshot().action).toMatchObject({
      kind: 'branch',
      machine: 'local',
      session: 'feature/task',
    });

    store.accept({ type: 'fleetCommandResult', requestId: 'branch-1', ok: true, code: 'success' } as ServerMessage);
    expect(sent[1]).toEqual({ type: 'fleetRequest', requestId: 'branch-2' });
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().latestRequestId).toBe('branch-2');
  });

  it('routes a local CI failure through the existing project diff comment message', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'r2' });

    store.sendLocalCiFailureComment('C:/repo/.worktrees/task', 'session-1', failedPullRequest);

    expect(sent).toEqual([{
      type: 'projectComment',
      requestId: 'r2',
      checkout: 'C:/repo/.worktrees/task',
      receivingSessionId: 'session-1',
      file: 'CI / PR #42',
      line: 1,
      snippet: 'lint\ntypecheck',
      content: 'CI đỏ · PR #42 · https://github.com/org/repo/pull/42. Hãy xử lý lỗi CI; không tự gộp.',
    }]);
  });

  it('accepts a late background analysis for the current fleet snapshot', () => {
    let requestIndex = 0;
    const store = createFleetStore({
      send: () => undefined,
      newRequestId: () => `r${++requestIndex}`,
    });
    const requestId = store.requestFleet();
    store.accept({
      type: 'fleetSnapshot',
      requestId,
      machines: [],
      overlaps: [],
      branchAnalyses: [],
      branchAnalysisPending: true,
    });
    store.accept({
      type: 'fleetSnapshot',
      requestId,
      machines: [],
      overlaps: [],
      branchAnalyses: [{
        id: 'local:/repo:feature',
        repo: 'repo',
        checkout: '/repo',
        branch: 'feature',
        changedFileCount: 1,
        modules: [{ name: 'src', count: 1 }],
        changedFiles: ['src/a.ts'],
        overlaps: [],
        suggestion: 'Gộp qua merge-lane',
      }],
      branchAnalysisPending: false,
    });

    expect(store.getSnapshot().snapshot?.branchAnalysisPending).toBe(false);
    expect(store.getSnapshot().snapshot?.branchAnalyses?.[0]?.changedFiles).toEqual(['src/a.ts']);
  });
});

describe('fleet task cleaning', () => {
  it('asks the machine to remove a task and records which one it removed', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'c1' });

    store.cleanTask('danh1', 'fix-aqp');

    expect(sent).toEqual([{ type: 'fleetTaskClean', requestId: 'c1', machine: 'danh1', session: 'fix-aqp' }]);
    expect(store.getSnapshot().action).toMatchObject({ kind: 'clean', machine: 'danh1', session: 'fix-aqp' });
    store.accept({ type: 'fleetTaskCleaned', requestId: 'c1', machine: 'danh1', session: 'fix-aqp' } as ServerMessage);
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().cleanedTask).toEqual({ machine: 'danh1', session: 'fix-aqp' });
  });

  it('keeps the machine\'s reason when it refuses and records nothing', () => {
    const store = createFleetStore({ send: () => undefined, newRequestId: () => 'c2' });

    store.cleanTask('danh1', 'fix-aqp');
    store.accept({ type: 'fleetCommandResult', requestId: 'c2', ok: false, code: 'failed', reason: 'Con file chua commit trong /x' } as ServerMessage);

    expect(store.getSnapshot().actionError).toBe('Con file chua commit trong /x');
    expect(store.getSnapshot().cleanedTask).toBeNull();
  });
});

describe('fleet machine wake', () => {
  it('asks to start a paused machine, then refreshes the fleet once InstaBox accepted it', () => {
    const sent: ClientMessage[] = [];
    let n = 0;
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => `w${(n += 1)}` });

    store.wakeMachine('danh1');

    expect(sent).toEqual([{ type: 'fleetMachineWake', requestId: 'w1', machine: 'danh1' }]);
    expect(store.getSnapshot().action).toMatchObject({ kind: 'wake', machine: 'danh1' });
    store.accept({ type: 'fleetCommandResult', requestId: 'w1', ok: true, code: 'success' } as ServerMessage);
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().actionError).toBeNull();
    expect(sent[1]).toMatchObject({ type: 'fleetRequest' });
  });

  it('keeps the reason when the machine could not be started and asks for no refresh', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'w9' });

    store.wakeMachine('danh1');
    store.accept({ type: 'fleetCommandResult', requestId: 'w9', ok: false, code: 'failed', reason: 'no such machine' } as ServerMessage);

    expect(store.getSnapshot().actionError).toBe('no such machine');
    expect(sent).toHaveLength(1);
  });

  it('ignores a second wake while the first is still running', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'w3' });

    store.wakeMachine('danh1');
    store.wakeMachine('danh1');

    expect(sent).toHaveLength(1);
  });
});

describe('fleet lavish delete', () => {
  it('asks the machine to delete the page, then refreshes the fleet so the row goes away', () => {
    const sent: ClientMessage[] = [];
    let n = 0;
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => `l${(n += 1)}` });

    store.deleteLavish('danh', '75553638e6141283');

    expect(sent).toEqual([{ type: 'fleetLavishDelete', requestId: 'l1', machine: 'danh', key: '75553638e6141283' }]);
    expect(store.getSnapshot().action).toMatchObject({ kind: 'lavishDelete', machine: 'danh' });
    store.accept({ type: 'fleetCommandResult', requestId: 'l1', ok: true, code: 'success' } as ServerMessage);
    expect(store.getSnapshot().action).toBeNull();
    expect(store.getSnapshot().actionError).toBeNull();
    expect(sent[1]).toMatchObject({ type: 'fleetRequest' });
  });

  it('keeps the machine reason when it refused and asks for no refresh', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'l9' });

    store.deleteLavish('danh', '75553638e6141283');
    store.accept({ type: 'fleetCommandResult', requestId: 'l9', ok: false, code: 'failed', reason: 'Tu choi' } as ServerMessage);

    expect(store.getSnapshot().actionError).toBe('Tu choi');
    expect(sent).toHaveLength(1);
  });

  it('ignores a second delete while the first is still running', () => {
    const sent: ClientMessage[] = [];
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => 'l3' });

    store.deleteLavish('danh', '75553638e6141283');
    store.deleteLavish('danh', '596fb6e7c69b625d');

    expect(sent).toHaveLength(1);
  });
});

describe('fleet reconnect', () => {
  it('drops an action whose answer was lost with the old socket, so the next click is sent', () => {
    const sent: ClientMessage[] = [];
    let n = 0;
    const store = createFleetStore({ send: (message) => sent.push(message), newRequestId: () => `r${(n += 1)}` });

    store.openTerminal('danh', 'heloo-74pr');
    expect(store.getSnapshot().action).toMatchObject({ kind: 'terminal' });

    store.connect();

    expect(store.getSnapshot().action).toBeNull();
    store.openTerminal('danh', 'heloo-74pr');
    expect(sent.filter((message) => message.type === 'fleetTerminalOpen')).toHaveLength(2);
  });

  it('closes the tab a lost lavish open had reserved', () => {
    const closed: string[] = [];
    const store = createFleetStore({ send: () => undefined, newRequestId: () => 'r1' });

    store.openLavish('danh', '75553638e6141283', { navigate: () => undefined, close: () => closed.push('closed') });
    store.connect();

    expect(closed).toEqual(['closed']);
    expect(store.getSnapshot().action).toBeNull();
  });
});
