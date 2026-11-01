import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { SESSION_RESTART_SCRIPT } from '../src/fleet/sessionRestart.js';

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

describe('CloudControl.restartSession', () => {
  it('sends the restart script on stdin and the session name only as an argument', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK heloo-74pr\n', stderr: '' });

    await expect(cloud.restartSession('danh', 'heloo-74pr')).resolves.toBeUndefined();

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args).toEqual(['exec', 'danh', '--timeout', '90', '--stdin', '--', 'bash', '-s', '--', 'heloo-74pr']);
    expect(exec?.input).toBe(SESSION_RESTART_SCRIPT);
  });

  it('reports the reason the machine gave when it refuses', async () => {
    const { cloud } = fakeCloud({ code: 6, stdout: 'Claude vua ghi hoi thoai trong 30 giay\n', stderr: '' });

    await expect(cloud.restartSession('danh', 'x')).rejects.toMatchObject({ code: 'failed', message: 'Claude vua ghi hoi thoai trong 30 giay' });
  });

  it('refuses a machine or session name that is not a plain name, without calling the machine', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK x\n', stderr: '' });

    await expect(cloud.restartSession('danh', 'bad;id')).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.restartSession('Danh 1', 'ok')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});
