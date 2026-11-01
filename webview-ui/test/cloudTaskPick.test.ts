import { describe, expect, it } from 'vitest';

import type { FleetMachineSnapshot } from '../../core/src/messages.js';
import { cloudHasRepo, pickMachine, PROJECT_REPOS, slugFromPrompt } from '../src/company/fleet/cloudTaskPick.js';

function machine(
  agentId: string,
  sessions: number,
  repos = PROJECT_REPOS,
  extra: { idleSeconds?: number; diskFreeGb?: number; state?: 'online' | 'stale' } = {},
): FleetMachineSnapshot {
  return {
    agentId,
    receivedAt: 0,
    state: extra.state ?? 'online',
    ...(extra.diskFreeGb === undefined ? {} : { diskFreeGb: extra.diskFreeGb }),
    sessionCount: 0,
    engines: [],
    repos: repos.map((name) => ({ name, branch: 'main', ahead: 0, behind: 0, dirtyCount: 0 })),
    tmuxSessions: Array.from({ length: sessions }, (_, i) => ({ name: `s${i}`, attached: false, idleSeconds: extra.idleSeconds ?? 0 })),
  };
}

describe('pickMachine', () => {
  it('takes the least busy machine that has all three project repositories', () => {
    expect(pickMachine([machine('danh', 2), machine('danh1', 1), machine('danh4', 0, [])])).toBe('danh1');
  });

  it('skips machines already running three agents and returns null when all are full', () => {
    expect(pickMachine([machine('danh', 3), machine('danh3', 2)])).toBe('danh3');
    expect(pickMachine([machine('danh', 3), machine('danh1', 4)])).toBeNull();
  });
});

describe('pickMachine ranking', () => {
  it('prefers a machine whose sessions are idle over one with the same number all working', () => {
    expect(pickMachine([machine('danh', 2), machine('danh1', 2, PROJECT_REPOS, { idleSeconds: 3600 })])).toBe('danh1');
  });

  it('avoids a machine short on disk unless it is the only one left', () => {
    const low = machine('danh', 0, PROJECT_REPOS, { diskFreeGb: 1 });
    expect(pickMachine([low, machine('danh1', 2, PROJECT_REPOS, { diskFreeGb: 20 })])).toBe('danh1');
    expect(pickMachine([low])).toBe('danh');
  });

  it('breaks a tie by free disk, not by name, and puts a stale report last', () => {
    expect(pickMachine([machine('danh', 1, PROJECT_REPOS, { diskFreeGb: 10 }), machine('danh3', 1, PROJECT_REPOS, { diskFreeGb: 40 })])).toBe('danh3');
    expect(pickMachine([machine('danh', 0, PROJECT_REPOS, { state: 'stale' }), machine('danh1', 2)])).toBe('danh1');
  });

  it('asks only for the repository the task needs', () => {
    const onlyWeb = machine('danh4', 0, [PROJECT_REPOS[1]!]);
    expect(pickMachine([onlyWeb, machine('danh', 2)])).toBe('danh');
    expect(pickMachine([onlyWeb, machine('danh', 2)], 'web')).toBe('danh4');
    expect(pickMachine([onlyWeb], 'backend')).toBeNull();
  });
});

describe('slugFromPrompt', () => {
  it('turns a Vietnamese request into a valid task name', () => {
    const slug = slugFromPrompt('Sửa lỗi xếp sân đôi khi Đổi giờ thi đấu', 'ab12');
    expect(slug).toBe('sua-loi-xep-san-doi-ab12');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
  });

  it('falls back to a generic name when the request has no letters or digits', () => {
    expect(slugFromPrompt('!!! ???', 'zz99')).toBe('viec-zz99');
  });
});

describe('cloudHasRepo', () => {
  const machines = [machine('danh', 0)];
  const folder = (id: string, path: string, parentId?: string) => ({ id, kind: 'folder', path, ...(parentId === undefined ? {} : { parentId }) });

  it('is true for a folder named like a repository a machine has, whatever the case', () => {
    expect(cloudHasRepo('f', [folder('f', 'V:/work/hethongbackendapi_quanlygiaidau')], machines)).toBe(true);
  });

  it('is false for a folder no machine has the repository of', () => {
    expect(cloudHasRepo('f', [folder('f', 'V:/pixel-agents')], machines)).toBe(false);
    expect(cloudHasRepo('f', [folder('f', 'V:/work/HethongBackendApi_QuanlyGiaiDau')], [machine('danh4', 0, [])])).toBe(false);
  });

  it('looks at the folders under a project node too', () => {
    const nodes = [{ id: 'p', kind: 'project' }, folder('f', 'V:/work/HethongFrontEndWeb_QLgiaidau', 'p')];
    expect(cloudHasRepo('p', nodes, machines)).toBe(true);
  });

  it('does not block a node that holds no folder at all', () => {
    expect(cloudHasRepo('p', [{ id: 'p', kind: 'project' }], machines)).toBe(true);
  });
});
