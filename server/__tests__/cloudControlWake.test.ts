import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';

function fakeCloud(answers: Partial<Record<'start' | 'wake', InstaboxResult | 'throw'>>) {
  const calls: { args: readonly string[]; home: string }[] = [];
  const deps: CloudControlDeps = {
    listConfigHomes: async () => ['/config'],
    run: async (args, home) => {
      calls.push({ args, home });
      if (args[0] === 'ls') return { code: 0, stdout: '[{"name":"danh1"}]', stderr: '' };
      const answer = answers[args[0] as 'start' | 'wake'] ?? { code: 0, stdout: '', stderr: '' };
      if (answer === 'throw') throw new Error('spawn failed');
      return answer;
    },
    launcher: { file: 'instabox', args: [] },
    now: () => 1_000,
    forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
  };
  return { cloud: new CloudControl(deps), calls };
}

describe('CloudControl.wakeMachine', () => {
  it('starts and wakes the machine in the account that owns it', async () => {
    const { cloud, calls } = fakeCloud({});

    await expect(cloud.wakeMachine('danh1')).resolves.toBeUndefined();

    const asked = calls.filter((call) => call.args[0] === 'start' || call.args[0] === 'wake');
    expect(asked.map((call) => call.args)).toEqual([['start', 'danh1'], ['wake', 'danh1']]);
    expect(asked.every((call) => call.home === '/config')).toBe(true);
  });

  it('succeeds when only one of start and wake works (a running machine refuses the other)', async () => {
    const { cloud } = fakeCloud({ start: { code: 1, stdout: '', stderr: 'already running' } });

    await expect(cloud.wakeMachine('danh1')).resolves.toBeUndefined();
  });

  it('says it failed when neither start nor wake worked', async () => {
    const { cloud } = fakeCloud({ start: 'throw', wake: { code: 3, stdout: '', stderr: 'no such machine' } });

    await expect(cloud.wakeMachine('danh1')).rejects.toMatchObject({ code: 'failed' });
  });

  it('rejects a name that is not a machine before any instabox call', async () => {
    const { cloud, calls } = fakeCloud({});

    await expect(cloud.wakeMachine('Danh 1; rm')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});
