import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

describe('imageUploadScript cleanup (TC-CLOUDIMG-03)', () => {
  const bash = spawnSync('bash', ['-c', 'true']).status === 0;

  it.skipIf(!bash)('writes the image and removes board images older than a week, never other files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'board-images-'));
    try {
      const dir = path.join(home, '.board-images');
      fs.mkdirSync(dir);
      const files = { old: '20200101000000-aaaaaaaa.png', fresh: '20261031000000-bbbbbbbb.png', other: 'notes.txt' };
      for (const name of Object.values(files)) fs.writeFileSync(path.join(dir, name), 'x');
      // The old image and the old non-image file are both a year old; only the image is the board's to remove.
      const past = new Date('2020-01-01T00:00:00Z');
      fs.utimesSync(path.join(dir, files.old), past, past);
      fs.utimesSync(path.join(dir, files.other), past, past);

      const result = spawnSync('bash', ['-s', '--', NAME], { input: imageUploadScript(DATA), env: { ...process.env, HOME: home }, encoding: 'utf8' });

      expect(result.stdout).toContain('OK ');
      expect(fs.existsSync(path.join(dir, NAME))).toBe(true);
      expect(fs.existsSync(path.join(dir, files.old))).toBe(false);
      expect(fs.existsSync(path.join(dir, files.fresh))).toBe(true);
      expect(fs.existsSync(path.join(dir, files.other))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
