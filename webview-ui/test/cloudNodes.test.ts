import { describe, expect, it } from 'vitest';

import type { FleetMachineSnapshot } from '../../core/src/messages.js';
import {
  CLOUD_OTHER_ID,
  CLOUD_SEEN_KEEP_MS,
  cloudNodeId,
  cloudTreeNodes,
  parseCloudNodeId,
  parseCloudSeen,
  rememberCloud,
} from '../src/company/fleet/cloudNodes.js';
import { buildAgentTree, isEndedNode, recentlyStoppedSessions, sessionFaceMood, stoppedLabel } from '../src/company/projects/projectTreeView.js';

const NOW = Date.parse('2026-10-31T08:00:00Z');
const REPOS = ['HethongFrontEndApp_QLgiaidau', 'HethongBackendApi_QuanlyGiaiDau', 'HethongFrontEndWeb_QLgiaidau'];

function repo(name: string, branch: string, extra: Partial<FleetMachineSnapshot['repos'][number]> = {}) {
  return { name, path: `/data/${name}`, branch, ahead: 1, behind: 0, dirtyCount: 0, ...extra };
}

function machine(overrides: Partial<FleetMachineSnapshot> = {}): FleetMachineSnapshot {
  return { agentId: 'danh', receivedAt: 0, state: 'online', sessionCount: 0, engines: [], repos: [], tmuxSessions: [], ...overrides };
}

const folderNode = { id: 'folder-web', kind: 'folder' as const, name: 'HethongFrontEndWeb_QLgiaidau', path: 'V:/Duancanhan/HethongFrontEndWeb_QLgiaidau' };
const nodes = [{ id: 'project-1', kind: 'project' as const, name: 'Project_QuanLyGiaiDau' }, { ...folderNode, parentId: 'project-1' }];
const base = { folders: {}, nodes, seen: {}, pending: null };

describe('cloud node ids', () => {
  it('round-trips machine and session, and refuses everything else', () => {
    expect(parseCloudNodeId(cloudNodeId('danh', 'hi-dnma'))).toEqual({ machine: 'danh', session: 'hi-dnma' });
    expect(parseCloudNodeId('abc')).toBeNull();
    expect(parseCloudNodeId(CLOUD_OTHER_ID)).toBeNull();
  });
});

describe('cloudTreeNodes', () => {
  it('shows a session that waits on a menu as waiting for you, so its face asks "?"', () => {
    const live = machine({
      tmuxSessions: [
        { name: 'ask', attached: false, idleSeconds: 300, asking: true, question: 'Which database? — 1. Postgres / 2. SQLite' },
        { name: 'quiet', attached: false, idleSeconds: 2 * 3600 },
      ],
    });
    const sessions = cloudTreeNodes({ ...base, machines: [live] }).filter((node) => node.kind === 'session');
    const byName = (name: string) => sessions.find((node) => node.name === name);
    expect(byName('ask')?.state).toBe('waiting_input');
    expect(sessionFaceMood(byName('ask')!)).toBe('waiting');
    expect(byName('quiet')?.state).toBe('idle');
    // TC-CLOUD-ASK-05: the row says what the session asks.
    expect(byName('ask')?.lastRequest).toBe('Đang hỏi: Which database? — 1. Postgres / 2. SQLite');
  });

  it('shows the sessions of a machine that stopped reporting as asleep, not as idle with a terminal that cannot open', () => {
    const paused = machine({ state: 'stale', receivedAt: NOW - 3_600_000, tmuxSessions: [{ name: 'hi-dnma', attached: false, idleSeconds: 3505, asking: true }] });
    const session = cloudTreeNodes({ ...base, machines: [paused] }).find((node) => node.kind === 'session');
    expect(session).toMatchObject({ id: 'cloud:danh/hi-dnma', state: 'sleeping', stoppedAt: new Date(NOW - 3_600_000).toISOString() });
    expect(sessionFaceMood(session!)).toBe('sleep');
  });

  it('turns a live tmux session into a session node under the folder named like its repository', () => {
    const live = machine({
      tmuxSessions: [{ name: 'hi-dnma', attached: false, idleSeconds: 5, branch: 'cloud/danh-hi-dnma' }],
      repos: REPOS.map((name) => repo(name, 'cloud/danh-hi-dnma')),
    });
    const result = cloudTreeNodes({ ...base, machines: [live] });
    const session = result.find((node) => node.kind === 'session');
    expect(session).toMatchObject({ id: 'cloud:danh/hi-dnma', parentId: 'folder-web', name: 'hi-dnma', state: 'working', branch: 'cloud/danh-hi-dnma' });
    expect(session?.stoppedAt).toBeUndefined();
    expect(session?.agentKind).toBeUndefined();
  });

  it('shows a session that stopped a while ago as resting and keeps its machine on the summary line', () => {
    const idle = machine({ tmuxSessions: [{ name: 'old', attached: false, idleSeconds: 3 * 3600, branch: 'cloud/danh-old' }], repos: [repo(REPOS[2], 'cloud/danh-old')] });
    const session = cloudTreeNodes({ ...base, machines: [idle] }).find((node) => node.kind === 'session');
    expect(session?.state).toBe('idle');
    expect(session?.request).toContain('danh');
    expect(session?.request).toContain('cloud/danh-old');
  });

  it('calls a session working until a full minute has passed without activity', () => {
    const at = (idleSeconds: number) => cloudTreeNodes({ ...base, machines: [machine({ tmuxSessions: [{ name: 's', attached: false, idleSeconds }] })] }).find((node) => node.kind === 'session')?.state;
    expect(at(59)).toBe('working');
    expect(at(60)).toBe('done');
  });

  it('TC-CLOUD-STATE-01 calls a session just finished for half an hour after it stopped, then free', () => {
    const at = (idleSeconds: number) => cloudTreeNodes({ ...base, machines: [machine({ tmuxSessions: [{ name: 's', attached: false, idleSeconds }] })] }).find((node) => node.kind === 'session');
    expect(at(30 * 60 - 1)?.state).toBe('done');
    expect(sessionFaceMood(at(30 * 60 - 1)!)).toBe('done');
    expect(at(30 * 60)?.state).toBe('idle');
  });

  it('uses the same tree builder as local sessions, so the row lands under its folder', () => {
    const live = machine({ tmuxSessions: [{ name: 'hi-dnma', attached: false, idleSeconds: 5, branch: 'cloud/danh-hi-dnma' }], repos: [repo(REPOS[2], 'cloud/danh-hi-dnma')] });
    const tree = buildAgentTree([...nodes, ...cloudTreeNodes({ ...base, machines: [live] })]);
    const folder = tree[0]?.children[0];
    expect(folder?.children.map((child) => child.node.id)).toEqual(['cloud:danh/hi-dnma']);
  });

  it('puts a session no folder claims under one "Cloud khác" group instead of dropping it', () => {
    const stray = machine({ tmuxSessions: [{ name: 'supabase-ci', attached: false, idleSeconds: 5, branch: 'cloud/danh-supabase-ci' }], repos: [repo('agent-chung-khoan', 'cloud/danh-supabase-ci')] });
    const result = cloudTreeNodes({ ...base, machines: [stray] });
    expect(result.find((node) => node.id === CLOUD_OTHER_ID)).toMatchObject({ kind: 'group', name: 'Cloud khác' });
    expect(result.find((node) => node.kind === 'session')?.parentId).toBe(CLOUD_OTHER_ID);
    expect(cloudTreeNodes({ ...base, machines: [machine()] })).toEqual([]);
  });

  it('keeps the folder the user started it from over the one its repository suggests', () => {
    const live = machine({ tmuxSessions: [{ name: 'fix', attached: false, idleSeconds: 5 }] });
    const result = cloudTreeNodes({ ...base, machines: [live], folders: { 'danh/fix': 'folder-web' } });
    expect(result.find((node) => node.kind === 'session')?.parentId).toBe('folder-web');
  });

  it('shows the row held while a task starts, before the machine lists its tmux session', () => {
    const result = cloudTreeNodes({ ...base, machines: [machine()], folders: { 'danh/hi-dnma': 'folder-web' }, pending: { machine: 'danh', session: 'hi-dnma' } });
    const session = result.find((node) => node.kind === 'session');
    expect(session).toMatchObject({ id: 'cloud:danh/hi-dnma', parentId: 'folder-web', state: 'working' });
    expect(session?.request).toContain('khởi động');
  });

  it('marks a remembered session asleep once its tmux session is gone, with the time it was last seen', () => {
    const seen = { 'danh/hi-dnma': { machine: 'danh', session: 'hi-dnma', folder: 'folder-web', branch: 'cloud/danh-hi-dnma', lastSeen: NOW - 5 * 60_000 } };
    const result = cloudTreeNodes({ ...base, machines: [machine()], seen });
    const session = result.find((node) => node.kind === 'session');
    expect(session).toMatchObject({ id: 'cloud:danh/hi-dnma', parentId: 'folder-web', state: 'sleeping' });
    expect(sessionFaceMood(session!)).toBe('sleep');
    expect(isEndedNode(session!)).toBe(false);
    expect(recentlyStoppedSessions(result, 6).map((node) => node.id)).toEqual(['cloud:danh/hi-dnma']);
    expect(stoppedLabel(session!, NOW)).toMatch(/^ngủ /);
  });

  it('drops a remembered session the machine no longer has anywhere: no tmux, no task entry, no branch', () => {
    const seen = { 'danh/hi-dnma': { machine: 'danh', session: 'hi-dnma', folder: 'folder-web', branch: 'cloud/danh-hi-dnma', lastSeen: NOW - 5 * 60_000 } };
    expect(cloudTreeNodes({ ...base, machines: [machine({ taskSlugs: ['other'] })], seen })).toEqual([]);
  });

  it('keeps it asleep while the machine still lists its task, because its worktree is still there to delete', () => {
    const seen = { 'danh/hi-dnma': { machine: 'danh', session: 'hi-dnma', folder: 'folder-web', lastSeen: NOW - 5 * 60_000 } };
    const result = cloudTreeNodes({ ...base, machines: [machine({ taskSlugs: ['hi-dnma'] })], seen });
    expect(result.find((node) => node.kind === 'session')).toMatchObject({ id: 'cloud:danh/hi-dnma', state: 'sleeping' });
  });

  it('does not call a session asleep while its machine is not reporting', () => {
    const seen = { 'danh/hi-dnma': { machine: 'danh', session: 'hi-dnma', folder: 'folder-web', lastSeen: NOW - 60_000 } };
    expect(cloudTreeNodes({ ...base, machines: [machine({ state: 'stale' })], seen })).toEqual([]);
    expect(cloudTreeNodes({ ...base, machines: [], seen })).toEqual([]);
    expect(cloudTreeNodes({ ...base, machines: [machine({ tmuxSessions: undefined })], seen })).toEqual([]);
  });

  it('finds work left on a cloud branch with no tmux session, even when nothing was remembered', () => {
    const left = machine({ repos: [repo(REPOS[2], 'cloud/danh-heloo-74pr'), repo(REPOS[1], 'cloud/danh-heloo-74pr')] });
    const session = cloudTreeNodes({ ...base, machines: [left] }).find((node) => node.kind === 'session');
    expect(session).toMatchObject({ id: 'cloud:danh/heloo-74pr', parentId: 'folder-web', state: 'sleeping', branch: 'cloud/danh-heloo-74pr' });
    expect(session?.stoppedAt).toBeUndefined();
  });

  it('ignores merged branches, branches with nothing on them and branches a live session already owns', () => {
    const quiet = machine({
      tmuxSessions: [{ name: 'live', attached: false, idleSeconds: 5, branch: 'cloud/danh-live' }],
      repos: [
        repo(REPOS[2], 'cloud/danh-merged', { merged: true }),
        repo(REPOS[2], 'cloud/danh-empty', { ahead: 0, dirtyCount: 0 }),
        repo(REPOS[2], 'cloud/danh-live'),
        repo(REPOS[2], 'main'),
        repo(REPOS[2], 'cloud/danh3-other'),
      ],
    });
    const ids = cloudTreeNodes({ ...base, machines: [quiet] }).filter((node) => node.kind === 'session').map((node) => node.id);
    expect(ids).toEqual(['cloud:danh/live']);
  });

  it('counts a branch with only uncommitted files as work left', () => {
    const dirty = machine({ repos: [repo(REPOS[2], 'cloud/danh-wip', { ahead: 0, dirtyCount: 3 })] });
    expect(cloudTreeNodes({ ...base, machines: [dirty] }).some((node) => node.id === 'cloud:danh/wip')).toBe(true);
  });
});

describe('rememberCloud', () => {
  const live = machine({ tmuxSessions: [{ name: 'hi-dnma', attached: false, idleSeconds: 5, branch: 'cloud/danh-hi-dnma' }], repos: [repo(REPOS[2], 'cloud/danh-hi-dnma')] });

  it('records every live session with its folder and the time it was seen', () => {
    const next = rememberCloud({}, [live], { 'danh/hi-dnma': 'folder-web' }, nodes, NOW);
    expect(next['danh/hi-dnma']).toMatchObject({ machine: 'danh', session: 'hi-dnma', folder: 'folder-web', branch: 'cloud/danh-hi-dnma', lastSeen: NOW });
  });

  it('keeps a session that vanished, with its old time, and forgets it after a day', () => {
    const seen = { 'danh/hi-dnma': { machine: 'danh', session: 'hi-dnma', lastSeen: NOW - 1000 } };
    expect(rememberCloud(seen, [machine()], {}, nodes, NOW)['danh/hi-dnma']?.lastSeen).toBe(NOW - 1000);
    expect(rememberCloud(seen, [machine()], {}, nodes, NOW + CLOUD_SEEN_KEEP_MS + 1)).toEqual({});
  });

  it('returns the same object when nothing changed, so a render does not rewrite storage', () => {
    const first = rememberCloud({}, [live], {}, nodes, NOW);
    expect(rememberCloud(first, [live], {}, nodes, NOW + 1000)).toBe(first);
  });
});

describe('parseCloudSeen', () => {
  const entry = { machine: 'danh', session: 'hi', lastSeen: NOW };

  it('keeps well-formed entries and drops everything else', () => {
    const raw = JSON.stringify({
      'danh/hi': { ...entry, folder: 'f', branch: 'b', path: '/p' },
      'danh/wrong-key': entry,
      'danh/num': { ...entry, session: 'num', branch: 5 },
      'danh/huge': { ...entry, session: 'huge', lastSeen: 1e300 },
      'danh/str': { ...entry, session: 'str', lastSeen: 'now' },
    });
    expect(Object.keys(parseCloudSeen(raw))).toEqual(['danh/hi']);
  });

  it('survives missing, broken and non-object storage', () => {
    expect(parseCloudSeen(null)).toEqual({});
    expect(parseCloudSeen('{oops')).toEqual({});
    expect(parseCloudSeen('[1]')).toEqual({});
  });
});

describe('cloud leftovers and folders, edge cases', () => {
  it('does not give a machine the branches of another machine whose name starts with its own', () => {
    const nested = [
      machine({ agentId: 'danh', repos: [repo(REPOS[2], 'cloud/danh-x-foo')] }),
      machine({ agentId: 'danh-x', repos: [repo(REPOS[2], 'cloud/danh-x-foo')] }),
    ];
    const ids = cloudTreeNodes({ ...base, machines: nested }).filter((node) => node.kind === 'session').map((node) => node.id);
    expect(ids).toEqual(['cloud:danh-x/foo']);
  });

  it('keeps the folder it remembered when the folder list has not loaded', () => {
    const live = machine({ tmuxSessions: [{ name: 'hi', attached: false, idleSeconds: 5 }] });
    const seen = { 'danh/hi': { machine: 'danh', session: 'hi', folder: 'folder-web', lastSeen: NOW - 5 * 60_000 } };
    expect(rememberCloud(seen, [live], {}, [], NOW)['danh/hi']?.folder).toBe('folder-web');
  });
});

describe('cloud rows, further review cases', () => {
  it('offers changes only for a path that is a repository of the session, never its bare working directory', () => {
    const manual = machine({ tmuxSessions: [{ name: 'manual', attached: false, idleSeconds: 5, cwd: '/home/danh' }] });
    const session = cloudTreeNodes({ ...base, machines: [manual] }).find((node) => node.kind === 'session');
    expect(session?.path).toBeUndefined();
  });

  it('does not refresh "last seen" from a machine that has stopped reporting', () => {
    const live = { tmuxSessions: [{ name: 'hi', attached: false, idleSeconds: 5 }] };
    const seen = { 'danh/hi': { machine: 'danh', session: 'hi', lastSeen: NOW - 10 * 60_000 } };
    expect(rememberCloud(seen, [machine({ ...live, state: 'stale' })], {}, nodes, NOW)).toBe(seen);
  });
});

describe('cloudTreeNodes prompts', () => {
  it('gives a session its last prompts, newest first, for the hover card and the row line', () => {
    const live = machine({
      tmuxSessions: [
        { name: 'asked', attached: false, idleSeconds: 300, recentRequests: ['newest', 'older', 'oldest'] },
        { name: 'quiet', attached: false, idleSeconds: 300 },
      ],
    });
    const sessions = cloudTreeNodes({ ...base, machines: [live] }).filter((node) => node.kind === 'session');
    const byName = (name: string) => sessions.find((node) => node.name === name);

    expect(byName('asked')?.recentRequests).toEqual(['newest', 'older', 'oldest']);
    expect(byName('asked')?.lastRequest).toBe('newest');
    expect(byName('quiet')?.recentRequests).toBeUndefined();
    expect(byName('quiet')?.lastRequest).toBeUndefined();
  });
});
