import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_COMMAND_TIMEOUT_MS } from '../src/company/constants.js';
import { projectBusyLabel } from '../src/company/projects/projectBusy.js';
import { createProjectStore, waitForProjectCreate } from '../src/company/projects/projectStore.js';

describe('project command timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gives up on a delete the server never answers, with a reason the board can show', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'd1' });
    store.deleteNode('n1');
    expect(Object.keys(store.getSnapshot().pending)).toEqual(['d1']);

    vi.advanceTimersByTime(PROJECT_COMMAND_TIMEOUT_MS);

    const state = store.getSnapshot();
    expect(state.pending).toEqual({});
    expect(state.errors['command:delete:n1']).toContain('chưa trả lời');
  });

  it('ends a create wait instead of hanging forever', async () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'c1' });
    const id = store.createNode({ kind: 'project', name: 'p', path: 'C:/p' });
    const outcome = waitForProjectCreate(store, id);

    vi.advanceTimersByTime(PROJECT_COMMAND_TIMEOUT_MS);

    expect(await outcome).toMatchObject({ refusal: expect.stringContaining('chưa trả lời') });
  });

  it('does not touch a command that was answered in time', () => {
    const store = createProjectStore({ send: () => undefined, newRequestId: () => 'd2' });
    store.deleteNode('n2');
    store.accept({ type: 'projectCommandResult', requestId: 'd2', command: 'delete', ok: true, nodeId: 'n2' } as never);

    vi.advanceTimersByTime(PROJECT_COMMAND_TIMEOUT_MS);

    expect(store.getSnapshot().errors['command:delete:n2']).toBeUndefined();
  });
});

describe('projectBusyLabel', () => {
  it('names the slow write commands and ignores reads', () => {
    expect(projectBusyLabel([{ type: 'projectNodeDelete' }, { type: 'projectTreeRequest' }])).toBe('Đang xóa khỏi danh sách…');
    expect(projectBusyLabel([{ type: 'projectNodeCreate' }])).toBe('Đang tạo project / thêm thư mục…');
    expect(projectBusyLabel([{ type: 'projectNodeMove' }])).toBe('Đang di chuyển…');
    expect(projectBusyLabel([{ type: 'projectTreeRequest' }, { type: 'projectDiffRequest' }])).toBeNull();
  });
});
