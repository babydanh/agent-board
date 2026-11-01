import { describe, expect, it } from 'vitest';

import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { imageUploadScript } from '../src/fleet/imageUpload.js';

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

const NAME = '20261101120000-ab12cd34.png';
const DATA = 'iVBORw0KGgo=';

describe('CloudControl.uploadImage (TC-CLOUDIMG-01)', () => {
  it('sends the bytes inside the script on stdin and the file name only as an argument', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: `OK /data/home/.board-images/${NAME}\n`, stderr: '' });

    await expect(cloud.uploadImage('danh1', NAME, DATA)).resolves.toBe(`/data/home/.board-images/${NAME}`);

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args).toEqual(['exec', 'danh1', '--timeout', '60', '--stdin', '--', 'bash', '-s', '--', NAME]);
    expect(exec?.input).toBe(imageUploadScript(DATA));
    expect(exec?.input).toContain(DATA);
  });

  it('reports the reason the machine gave when the write fails', async () => {
    const { cloud } = fakeCloud({ code: 1, stdout: 'Khong ghi duoc anh\n', stderr: '' });

    await expect(cloud.uploadImage('danh1', NAME, DATA)).rejects.toMatchObject({ code: 'failed', message: 'Khong ghi duoc anh' });
  });

  it('refuses a machine, file name or payload that could reach the shell, before any exec', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'OK /x\n', stderr: '' });

    await expect(cloud.uploadImage('Danh 1', NAME, DATA)).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.uploadImage('danh1', '../x.png', DATA)).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.uploadImage('danh1', 'a;b.png', DATA)).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.uploadImage('danh1', NAME, 'abc\nB64\nrm -rf ~')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});
