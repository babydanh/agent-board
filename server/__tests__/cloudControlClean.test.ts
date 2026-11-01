import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { TASK_CLEAN_SCRIPT } from '../src/fleet/taskClean.js';

function fakeCloud(answer: InstaboxResult) {
  const calls: { args: readonly string[]; input?: string }[] = [];
  const deps: CloudControlDeps = {
    listConfigHomes: async () => ['/config'],
    run: async (args, _home, input) => {
      calls.push({ args, ...(input === undefined ? {} : { input }) });
      return args[0] === 'ls' ? { code: 0, stdout: '[{"name":"danh1"}]', stderr: '' } : answer;
    },
    launcher: { file: 'instabox', args: [] },
    now: () => 1_000,
    forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
  };
  return { cloud: new CloudControl(deps), calls };
}

describe('CloudControl.cleanTask', () => {
  it('sends the clean script on stdin and the slug only as an argument', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK fix-aqp\n', stderr: '' });

    await expect(cloud.cleanTask('danh1', 'fix-aqp')).resolves.toBeUndefined();

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args).toEqual(['exec', 'danh1', '--timeout', '120', '--stdin', '--', 'bash', '-s', '--', 'fix-aqp']);
    expect(exec?.input).toBe(TASK_CLEAN_SCRIPT);
  });

  it('asks the machine to push the branch first only when told to', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK fix-aqp\n', stderr: '' });

    await cloud.cleanTask('danh1', 'fix-aqp', true);

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args.slice(-3)).toEqual(['--', 'fix-aqp', 'push']);
  });

  it('reports the reason the machine gave when it refuses', async () => {
    const { cloud } = fakeCloud({ code: 7, stdout: 'Con file chua commit trong /data/home/wt/web-x\n', stderr: '' });

    await expect(cloud.cleanTask('danh1', 'x')).rejects.toMatchObject({
      code: 'failed',
      message: 'Con file chua commit trong /data/home/wt/web-x',
    });
  });

  it('rejects names that are not a machine and a task slug before any exec', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK\n', stderr: '' });

    await expect(cloud.cleanTask('danh1', 'bad;id')).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.cleanTask('Danh 1', 'ok')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});
