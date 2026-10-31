import { describe, expect, it } from 'vitest';

import type { FleetMachineSnapshot } from '../../core/src/messages.js';
import { cloudHasRepo, pickMachine, PROJECT_REPOS, slugFromPrompt } from '../src/company/fleet/cloudTaskPick.js';

function machine(agentId: string, sessions: number, repos = PROJECT_REPOS): FleetMachineSnapshot {
  return {
    agentId,
    receivedAt: 0,
    state: 'online',
    sessionCount: 0,
    engines: [],
    repos: repos.map((name) => ({ name, branch: 'main', ahead: 0, behind: 0, dirtyCount: 0 })),
    tmuxSessions: Array.from({ length: sessions }, (_, i) => ({ name: `s${i}`, attached: false, idleSeconds: 0 })),
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
