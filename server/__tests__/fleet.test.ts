import { describe, expect, it, vi } from 'vitest';

import type { GitGuardReport, LedgerView, ServerMessage } from '../../core/src/messages.js';
import { CloudControl, type CloudControlDeps } from '../src/fleet/cloudControl.js';
import {
  FLEET_REASON_BAD_INPUT,
  FLEET_REASON_COMMAND_FAILED,
  FLEET_REASON_HUB_FALLBACK,
  FLEET_REASON_READ_ONLY,
  FLEET_STALE_AFTER_MS,
} from '../src/fleet/constants.js';
import {
  buildFleetSnapshot,
  classifyFleetMachineState,
  computeFleetOverlaps,
} from '../src/fleet/fleetSnapshot.js';
import { handleFleetMessage } from '../src/fleet/handler.js';
import type { FleetHubClient, FleetHubMachine } from '../src/fleet/hubClient.js';
import type { PtySessionManager } from '../src/terminal/ptySessionManager.js';

/** CloudControl deps that never reach the real InstaBox CLI; override only what a test needs. */
function fakeInstabox(overrides: Partial<CloudControlDeps>): CloudControlDeps {
  return {
    listConfigHomes: async () => ['/config'],
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
    launcher: { file: 'instabox', args: [] },
    now: () => 1_000_000,
    forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
    ...overrides,
  };
}

function machine(agent_id: string, path: string, dirty_files: string[]): FleetHubMachine {
  return {
    agent_id,
    received_at: 1_000,
    sessions: [],
    repos: [{ path, branch: 'main', ahead: 0, behind: 0, dirty_files }],
  };
}

describe('fleet snapshot calculations', () => {
  it('finds the same dirty file across two cloud machines', () => {
    expect(
      computeFleetOverlaps(
        [
          machine('danh1', 'C:/work/pixel-agents', ['server/src/fleet.ts']),
          machine('danh4', 'D:/projects/pixel-agents', ['server/src/fleet.ts']),
        ],
        [],
      ),
    ).toEqual([
      { repo: 'pixel-agents', path: 'server/src/fleet.ts', machines: ['danh1', 'danh4'], local: false, level: 'file', detail: '' },
    ]);
  });

  it('maps .worktrees checkouts to their repository when matching local dirty files', () => {
    expect(
      computeFleetOverlaps(
        [machine('danh5', 'D:/projects/pixel-agents.worktrees/cloud', ['server/src/fleet.ts'])],
        [{ repo: 'C:/work/pixel-agents/.worktrees/local', dirtyFiles: ['server/src/fleet.ts'] }],
      ),
    ).toEqual([
      { repo: 'pixel-agents', path: 'server/src/fleet.ts', machines: ['danh5'], local: true, level: 'file', detail: '' },
    ]);
  });

  it('does not report matching file names in different repositories', () => {
    expect(
      computeFleetOverlaps(
        [
          machine('danh1', 'C:/work/pixel-agents', ['server/src/fleet.ts']),
          machine('danh4', 'D:/projects/another-project', ['server/src/fleet.ts']),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('warns at line level only when changed ranges of two machines intersect', () => {
    const withRanges = (id: string, ranges: [number, number][]): FleetHubMachine => ({
      agent_id: id,
      received_at: 1_000,
      sessions: [],
      repos: [{ path: '/data/home/api', branch: `cloud/${id}`, ahead: 1, behind: 0, dirty_files: [], changes: [{ path: 'src/a.ts', ranges }] }],
    });
    expect(computeFleetOverlaps([withRanges('danh', [[10, 20]]), withRanges('danh4', [[40, 50]])], [])).toEqual([]);
    expect(computeFleetOverlaps([withRanges('danh', [[10, 20]]), withRanges('danh4', [[18, 25]])], [])).toEqual([
      { repo: 'api', path: 'src/a.ts', machines: ['danh', 'danh4'], local: false, level: 'line', detail: 'danh: dòng 10–20 · danh4: dòng 18–25' },
    ]);
  });

  it('falls back to a file-level warning when one side has no line data', () => {
    const ranged: FleetHubMachine = {
      agent_id: 'danh', received_at: 1_000, sessions: [],
      repos: [{ path: '/data/home/api', branch: 'x', ahead: 1, behind: 0, dirty_files: [], changes: [{ path: 'src/a.ts', ranges: [[10, 20]] }] }],
    };
    const [warning] = computeFleetOverlaps([ranged, machine('danh4', '/data/home/api', ['src/a.ts'])], []);
    expect(warning).toMatchObject({ machines: ['danh', 'danh4'], level: 'file' });
  });

  it('classifies only machine reports older than ten minutes as stale', () => {
    const now = 1_000_000;
    expect(classifyFleetMachineState(now - FLEET_STALE_AFTER_MS, now)).toBe('online');
    expect(classifyFleetMachineState(now - FLEET_STALE_AFTER_MS - 1, now)).toBe('stale');
  });
});

describe('handleFleetMessage', () => {
  it('refuses requests from unprivileged connections without fetching fleet data', () => {
    const sent: ServerMessage[] = [];
    const fleet: FleetHubClient = { fetchFleet: vi.fn(async () => ({ now: 1_000, machines: [] })) };

    const handled = handleFleetMessage(
      { type: 'fleetRequest', requestId: 'request-1' },
      (message) => sent.push(message),
      { fleet, ledger: null, privileged: false },
    );

    expect(handled).toBe(true);
    expect(sent).toEqual([
      {
        type: 'fleetCommandResult',
        requestId: 'request-1',
        ok: false,
        code: 'forbidden',
        reason: FLEET_REASON_READ_ONLY,
      },
    ]);
    expect(fleet.fetchFleet).not.toHaveBeenCalled();
  });

  it('only runs branch actions for a checkout and branch present in the local ledger', async () => {
    const sent: ServerMessage[] = [];
    const processRunner = vi.fn(async () => { throw new Error('unexpected process'); });
    const view = {
      repos: [{
        repo: '/repo',
        name: 'repo',
        worktrees: [{ path: '/repo/worktrees/task', branch: 'feature/task' }],
      }],
    } as unknown as LedgerView;
    const ledger = { getView: vi.fn(async () => view) };

    const handled = handleFleetMessage({
      type: 'fleetBranchAction',
      requestId: 'branch-1',
      action: 'push',
      checkout: '/not-reported',
      branch: 'feature/task',
    }, (message) => sent.push(message), { ledger, processRunner, privileged: true });
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: 'fleetCommandResult',
      requestId: 'branch-1',
      ok: false,
    });
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('keeps the local guard visible when the cloud hub is unavailable', async () => {
    const sent: ServerMessage[] = [];
    const guard: GitGuardReport = {
      machine: 'local',
      scannedAt: new Date(1_000).toISOString(),
      repos: [],
      risks: [],
    };
    const fleet: FleetHubClient = {
      fetchFleet: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    // InstaBox is unreachable too: the fallback read fails and must not fall through to the real CLI.
    const cloud = new CloudControl({
      ...fakeInstabox({ listConfigHomes: async () => Promise.reject(new Error('no instabox')) }),
    });
    handleFleetMessage(
      { type: 'fleetRequest', requestId: 'request-2' },
      (message) => sent.push(message),
      { fleet, cloud, ledger: null, getLocalGuard: () => guard, privileged: true },
    );
    // The snapshot comes first; the branch analysis may follow as a second update.
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(1));
    expect(sent[0]).toMatchObject({
      type: 'fleetSnapshot',
      localGuard: guard,
      machines: [],
      hubError: FLEET_REASON_COMMAND_FAILED,
    });
  });

  it('still lists the tmux sessions of running machines when the hub answers an error (TC-HUBFALLBACK-04)', async () => {
    const sent: ServerMessage[] = [];
    const fleet: FleetHubClient = {
      fetchFleet: vi.fn(async () => {
        throw new Error('Fleet hub responded with 409.');
      }),
    };
    const cloud = new CloudControl(
      fakeInstabox({
        run: async (args) =>
          args[0] === 'ls'
            ? { code: 0, stdout: '[{"name":"danh","state":"running"}]', stderr: '' }
            : { code: 0, stdout: 'hi-dnma|0|990|/data/home/wt/x\n', stderr: '' },
      }),
    );
    handleFleetMessage({ type: 'fleetRequest', requestId: 'request-3' }, (message) => sent.push(message), {
      fleet,
      cloud,
      ledger: null,
      privileged: true,
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(1));
    expect(sent[0]).toMatchObject({
      type: 'fleetSnapshot',
      hubError: FLEET_REASON_HUB_FALLBACK,
      machines: [{ agentId: 'danh', tmuxSessions: [{ name: 'hi-dnma' }] }],
    });
  });
});

describe('cloud tmux sessions in the snapshot', () => {
  it('passes valid session names through and drops names that could reach a shell', () => {
    const snapshot = buildFleetSnapshot(
      'r',
      {
        now: 1_000,
        machines: [
          {
            ...machine('danh', '/data/home/Backend', []),
            tmux: [
              {
                name: 'xep-san',
                attached: true,
                idle_seconds: 90.7,
                command: 'claude',
                branch: 'cloud/danh-xep-san',
                cwd: '/data/home/Backend/wt',
              },
              { name: 'x;rm -rf ~', attached: false, idle_seconds: 1 },
            ],
          },
        ],
      },
      null,
    );
    expect(snapshot.machines[0].tmuxSessions).toEqual([
      { name: 'xep-san', attached: true, idleSeconds: 90, engine: 'claude', command: 'claude', branch: 'cloud/danh-xep-san', cwd: '/data/home/Backend/wt' },
    ]);
    expect(snapshot.machines[0].activePaths).toEqual(['/data/home/Backend/wt']);
  });
});

function fakeCloud(machines: Record<string, string[]>) {
  const calls: { args: readonly string[]; home: string; input?: string }[] = [];
  const forwards: { machine: string; remotePort: number; home: string; stopped: boolean }[] = [];
  const deps: CloudControlDeps = {
    launcher: { file: 'node', args: ['instabox.mjs'] },
    now: () => 0,
    listConfigHomes: async () => Object.keys(machines),
    run: async (args, home, input) => {
      calls.push({ args, home, input });
      if (args[0] === 'ls') return { code: 0, stdout: JSON.stringify(machines[home].map((name) => ({ name }))), stderr: '' };
      if (args[0] === 'exec' && args.includes('cloud-giao')) return { code: 0, stdout: `OK ${args[7]} /wt cloud/x\n`, stderr: '' };
      if (args[0] === 'exec') return { code: 0, stdout: '### git status\n## cloud/danh-x\n M src/a.ts\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    forward: async (machine, remotePort, home) => {
      const record = { machine, remotePort, home, stopped: false };
      forwards.push(record);
      return { localPort: 40000 + forwards.length, alive: () => !record.stopped, stop: () => { record.stopped = true; } };
    },
  };
  return { cloud: new CloudControl(deps), calls, forwards };
}

describe('cloud control', () => {
  it('refuses terminal and task commands from unprivileged connections', () => {
    const { cloud, calls } = fakeCloud({ '/a': ['danh'] });
    for (const type of ['fleetTerminalOpen', 'fleetTaskCreate']) {
      const sent: ServerMessage[] = [];
      handleFleetMessage({ type, requestId: 'r', machine: 'danh', session: 's' }, (m) => sent.push(m), {
        cloud,
        ledger: null,
        privileged: false,
      });
      expect(sent).toEqual([expect.objectContaining({ code: 'forbidden' })]);
    }
    expect(calls).toEqual([]);
  });

  it('rejects a slug with shell characters before running anything', async () => {
    const { cloud, calls } = fakeCloud({ '/a': ['danh'] });
    const sent: ServerMessage[] = [];
    handleFleetMessage(
      { type: 'fleetTaskCreate', requestId: 'r', machine: 'danh', repo: 'backend', slug: 'a;reboot', prompt: 'x' },
      (m) => sent.push(m),
      { cloud, ledger: null, privileged: true },
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: 'fleetCommandResult', code: 'failed', reason: FLEET_REASON_BAD_INPUT });
    expect(calls).toEqual([]);
  });

  it('runs cloud-giao under the account that owns the machine, with the prompt on stdin', async () => {
    const { cloud, calls } = fakeCloud({ '/a': ['danh'], '/b': ['danh3'] });
    await expect(cloud.createTask('danh3', 'web', 'xep-san', 'Lam trang xep san')).resolves.toBe('xep-san');
    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec).toEqual({
      args: ['exec', 'danh3', '--timeout', '300', '--stdin', '--', 'cloud-giao', 'web', 'xep-san', 'danh3'],
      home: '/b',
      input: 'Lam trang xep san',
    });
  });

  it('asks cloud-giao for omp with an explicit --engine flag, and keeps the claude argv unchanged', async () => {
    const { cloud, calls } = fakeCloud({ '/b': ['danh3'] });
    await cloud.createTask('danh3', 'all', 'xep-san', 'Lam trang xep san', 'omp');
    expect(calls.find((call) => call.args[0] === 'exec')?.args).toEqual([
      'exec', 'danh3', '--timeout', '300', '--stdin', '--', 'cloud-giao', '--engine', 'omp', 'all', 'xep-san', 'danh3',
    ]);
    await cloud.createTask('danh3', 'all', 'viec-hai', 'Lam tiep', 'claude');
    expect(calls.filter((call) => call.args[0] === 'exec').at(-1)?.args).toEqual([
      'exec', 'danh3', '--timeout', '300', '--stdin', '--', 'cloud-giao', 'all', 'viec-hai', 'danh3',
    ]);
  });

  it('rejects an unknown engine before running anything', async () => {
    const { cloud, calls } = fakeCloud({ '/a': ['danh'] });
    await expect(cloud.createTask('danh', 'web', 'xep-san', 'x', 'codex' as never)).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });

  it('tells the user a machine whose cloud-giao is too old cannot start omp, instead of a vague usage line', async () => {
    const deps: CloudControlDeps = {
      launcher: { file: 'node', args: ['instabox.mjs'] },
      now: () => 0,
      listConfigHomes: async () => ['/a'],
      run: async (args) =>
        args[0] === 'ls'
          ? { code: 0, stdout: JSON.stringify([{ name: 'danh' }]), stderr: '' }
          : { code: 2, stdout: 'Repo phai la backend, web, app hoac all', stderr: '' },
      forward: async () => ({ localPort: 1, alive: () => true, stop: () => undefined }),
    };
    await expect(new CloudControl(deps).createTask('danh', 'web', 'xep-san', 'x', 'omp')).rejects.toThrow(/chưa hỗ trợ omp/);
  });

  it('reuses the live terminal for the same machine and session', async () => {
    const { cloud } = fakeCloud({ '/a': ['danh'] });
    const live = new Set<number>();
    const create = vi.fn((options: { agentId: number }) => live.add(options.agentId));
    const pty = { create, has: (id: number) => live.has(id) } as unknown as PtySessionManager;
    const first = await cloud.openTerminal(pty, 'danh', 'xep-san');
    expect(await cloud.openTerminal(pty, 'danh', 'xep-san')).toBe(first);
    expect(await cloud.openTerminal(pty, 'danh', 'khac')).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({ env: { XDG_CONFIG_HOME: '/a' } });
  });

  it('opens Lavish through one forward per machine to the loopback port, and rejects non-hex keys', async () => {
    const { cloud, forwards } = fakeCloud({ '/a': ['danh'] });
    expect(await cloud.openLavish('danh', 'b702b4f8df032645')).toBe('http://127.0.0.1:40001/session/b702b4f8df032645');
    expect(await cloud.openLavish('danh', 'aaaaaaaa11')).toBe('http://127.0.0.1:40001/session/aaaaaaaa11');
    expect(forwards).toEqual([{ machine: 'danh', remotePort: 4800, home: '/a', stopped: false }]);
    await expect(cloud.openLavish('danh', '../../etc')).rejects.toMatchObject({ code: 'bad_input' });
    cloud.dispose();
    expect(forwards[0].stopped).toBe(true);
  });

  it('reads a diff only for a repository path the machine reported', async () => {
    const { cloud, calls } = fakeCloud({ '/a': ['danh'] });
    const fleet: FleetHubClient = {
      fetchFleet: async () => ({
        now: 1_000,
        machines: [{ ...machine('danh', '/data/home/wt/backend-x', []) }],
      }),
    };
    const ask = async (path: string) => {
      const sent: ServerMessage[] = [];
      handleFleetMessage({ type: 'fleetDiffRequest', requestId: 'r', machine: 'danh', path }, (m) => sent.push(m), {
        cloud,
        fleet,
        ledger: null,
        privileged: true,
      });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      return sent[0];
    };
    expect(await ask('/data/home/.ssh')).toMatchObject({ type: 'fleetCommandResult', code: 'failed' });
    expect(calls.filter((call) => call.args[0] === 'exec')).toEqual([]);
    expect(await ask('/data/home/wt/backend-x')).toMatchObject({
      type: 'fleetDiff',
      path: '/data/home/wt/backend-x',
      truncated: false,
      text: expect.stringContaining('M src/a.ts'),
    });
  });
});

describe('skill sync version in the snapshot', () => {
  const build = (skill_version: string | null | undefined, expected: string | null) =>
    buildFleetSnapshot(
      'r',
      { now: 1_000, machines: [{ ...machine('danh', '/data/home/Backend', []), skill_version }] },
      null,
      null,
      expected,
    ).machines[0];

  it('marks a machine stale when its version differs from the last synced one', () => {
    expect(build('aaaaaaaaaaaa', 'bbbbbbbbbbbb')).toMatchObject({ skillVersion: 'aaaaaaaaaaaa', skillStale: true });
  });

  it('claims nothing about a machine that reports no version: its agent may simply be too old to say', () => {
    expect(build(null, 'bbbbbbbbbbbb').skillStale).toBeUndefined();
    expect(build(undefined, 'bbbbbbbbbbbb').skillStale).toBeUndefined();
  });

  it('marks a machine current when versions match', () => {
    expect(build('bbbbbbbbbbbb', 'bbbbbbbbbbbb')).toMatchObject({ skillVersion: 'bbbbbbbbbbbb', skillStale: false });
  });

  it('says nothing about staleness when the last synced version is unknown', () => {
    expect(build('aaaaaaaaaaaa', null).skillStale).toBeUndefined();
  });
});

describe('task slugs in the snapshot', () => {
  const build = (viec: FleetHubMachine['viec']) =>
    buildFleetSnapshot('r', { now: 1_000, machines: [{ ...machine('danh', '/data/home/Backend', []), viec }] }, null).machines[0];

  it('lists every task the machine remembers, finished ones too, so the board can tell a deleted session from a finished one', () => {
    const tasks = [
      { slug: 'a', status: 'dang-lam' as const, branch: 'cloud/danh-a' },
      { slug: 'b', status: 'xong' as const, branch: 'cloud/danh-b' },
    ];
    expect(build(tasks).taskSlugs).toEqual(['a', 'b']);
    expect(build([]).taskSlugs).toEqual([]);
  });

  it('says nothing when the hub did not send a task list', () => {
    expect(build(undefined).taskSlugs).toBeUndefined();
  });
});

describe('task slugs, hub list limit', () => {
  it('leaves taskSlugs out when the list is as long as the hub keeps, since it may have been cut', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({ slug: `t${i}`, status: 'xong' as const, branch: `cloud/danh-t${i}` }));
    const snapshot = buildFleetSnapshot('r', { now: 1_000, machines: [{ ...machine('danh', '/data/home/Backend', []), viec: tasks }] }, null);
    expect(snapshot.machines[0].taskSlugs).toBeUndefined();
  });
});
