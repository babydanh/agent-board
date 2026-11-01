import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { listedMachines, parseTmuxPanes, TMUX_PANES_SCRIPT } from '../src/fleet/hubFallback.js';

describe('listedMachines (TC-HUBFALLBACK-01)', () => {
  it('marks only machines InstaBox reports running as awake, so a sleeping one is never woken', () => {
    const json = JSON.stringify([
      { name: 'danh', state: 'running' },
      { name: 'danh2', state: 'suspended' },
      { name: 'danh3', state: 'paused' },
      { name: 'danh4' },
    ]);
    expect(listedMachines(json)).toEqual([
      { name: 'danh', running: true },
      { name: 'danh2', running: false },
      { name: 'danh3', running: false },
      { name: 'danh4', running: false },
    ]);
  });

  it('reads garbage as no machines', () => {
    expect(listedMachines('not json')).toEqual([]);
    expect(listedMachines('{"name":"danh","state":"running"}')).toEqual([]);
  });
});

describe('parseTmuxPanes (TC-HUBFALLBACK-02)', () => {
  it('takes one entry per session with idle seconds and cwd, skipping odd lines and names', () => {
    const dump = ['heloo-74pr|1|990|/data/home/wt/x', 'heloo-74pr|0|100|/other', 'hi-dnma|0|1000|/a|b', "bad name|0|1|/x", 'junk', ''].join('\n');

    expect(parseTmuxPanes(dump, 1000)).toEqual([
      { name: 'heloo-74pr', attached: true, idle_seconds: 10, cwd: '/data/home/wt/x' },
      { name: 'hi-dnma', attached: false, idle_seconds: 0, cwd: '/a|b' },
    ]);
  });
});

describe('CloudControl.readRunningTmux (TC-HUBFALLBACK-03)', () => {
  function fakeCloud(execAnswer: (machine: string) => InstaboxResult, clock = { now: 1_000_000 }) {
    const calls: (readonly string[])[] = [];
    const deps: CloudControlDeps = {
      listConfigHomes: async () => ['/a', '/b'],
      run: async (args, home) => {
        calls.push(args);
        if (args[0] === 'ls') {
          const list = home === '/a' ? [{ name: 'danh', state: 'running' }, { name: 'danh3', state: 'suspended' }] : [{ name: 'danh1', state: 'running' }];
          return { code: 0, stdout: JSON.stringify(list), stderr: '' };
        }
        return execAnswer(args[1] ?? '');
      },
      launcher: { file: 'instabox', args: [] },
      now: () => clock.now,
      forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
    };
    return { cloud: new CloudControl(deps), calls, clock };
  }

  it('execs only running machines, leaves a failing one out, and never starts or wakes anything', async () => {
    const { cloud, calls } = fakeCloud((machine) =>
      machine === 'danh' ? { code: 0, stdout: 'hi-dnma|0|999|/x\n', stderr: '' } : { code: 255, stdout: '', stderr: 'ssh failed' },
    );

    const response = await cloud.readRunningTmux();

    expect(response.machines.map((machine) => machine.agent_id)).toEqual(['danh', 'danh3']);
    // A sleeping machine is listed as never seen, so the board sorts it under the sleepers; nothing is run on it.
    expect(response.machines[1]).toMatchObject({ agent_id: 'danh3', received_at: 0, tmux: [] });
    expect(response.machines[0]?.tmux).toEqual([{ name: 'hi-dnma', attached: false, idle_seconds: 1, cwd: '/x' }]);
    const execs = calls.filter((args) => args[0] === 'exec');
    expect(execs.map((args) => args[1]).sort()).toEqual(['danh', 'danh1']);
    expect(execs.some((args) => args[1] === 'danh3')).toBe(false);
    expect(execs[0]?.at(-1)).toBe(TMUX_PANES_SCRIPT);
    expect(calls.some((args) => args[0] === 'start' || args[0] === 'wake')).toBe(false);
  });

  it('answers a second call inside the cache window without any new InstaBox call', async () => {
    const { cloud, calls, clock } = fakeCloud(() => ({ code: 0, stdout: '', stderr: '' }));

    await cloud.readRunningTmux();
    const first = calls.length;
    clock.now += 10_000;
    await cloud.readRunningTmux();
    expect(calls).toHaveLength(first);

    clock.now += 60_000;
    await cloud.readRunningTmux();
    expect(calls.length).toBeGreaterThan(first);
  });
});
