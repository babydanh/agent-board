import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { LAVISH_DELETE_SCRIPT } from '../src/fleet/lavishDelete.js';

function fakeCloud(answer: InstaboxResult) {
  const calls: { args: readonly string[]; input?: string }[] = [];
  const deps: CloudControlDeps = {
    listConfigHomes: async () => ['/config'],
    run: async (args, _home, input) => {
      calls.push({ args, ...(input === undefined ? {} : { input }) });
      return args[0] === 'ls' ? { code: 0, stdout: '[{"name":"danh"}]', stderr: '' } : answer;
    },
    launcher: { file: 'instabox', args: [] },
    now: () => 1_000,
    forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
  };
  return { cloud: new CloudControl(deps), calls };
}

describe('CloudControl.deleteLavish', () => {
  it('sends the delete script on stdin and the key only as an argument', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK 75553638e6141283 /data/home/wt/x/.lavish/plan.html\n', stderr: '' });

    await expect(cloud.deleteLavish('danh', '75553638e6141283')).resolves.toBeUndefined();

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args).toEqual(['exec', 'danh', '--timeout', '60', '--stdin', '--', 'bash', '-s', '--', '75553638e6141283']);
    expect(exec?.input).toBe(LAVISH_DELETE_SCRIPT);
  });

  it('reports the reason the machine gave when it refuses', async () => {
    const { cloud } = fakeCloud({ code: 3, stdout: 'Tu choi: trang Lavish phai nam trong thu muc .lavish\n', stderr: '' });

    await expect(cloud.deleteLavish('danh', '75553638e6141283')).rejects.toMatchObject({
      code: 'failed',
      message: 'Tu choi: trang Lavish phai nam trong thu muc .lavish',
    });
  });

  it('rejects a key that is not hex and a bad machine name before any exec', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK\n', stderr: '' });

    await expect(cloud.deleteLavish('danh', '../etc/passwd')).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.deleteLavish('Danh 1', '75553638e6141283')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});
