import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Git Bash puts GNU tar first on PATH; it cannot read zips. Windows ships bsdtar.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function buildZip() {
  execFileSync(process.execPath, [join(here, 'build-zip.mjs')], { encoding: 'utf8' });
  return join(here, 'out', 'botkeep-fleet-hub.zip');
}

test('TC-HUBBUNDLE-01: the zip holds only the runtime files, never keys or state', () => {
  const names = execFileSync(tar, ['-t', '-f', buildZip()], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(names, ['commandSpec.mjs', 'hub.mjs', 'jwt.mjs', 'package.json', 'server.js']);
});

test('TC-HUBBUNDLE-02: the extracted zip starts a hub that creates empty keys and refuses an unsigned read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-bundle-'));
  const app = join(root, 'app');
  mkdirSync(app);
  execFileSync(tar, ['-x', '-f', buildZip(), '-C', app]);
  const data = join(root, 'data');
  const child = spawn(process.execPath, [join(app, 'server.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', FLEET_DATA: data },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hub did not start')), 10_000);
      child.stdout.on('data', (chunk) => {
        const match = /listening 127\.0\.0\.1:(\d+)/.exec(String(chunk));
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`hub exited ${code}`)); });
    });
    assert.equal(readFileSync(join(data, 'keys.json'), 'utf8'), '{}');
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/fleet`)).status, 401);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(join(here, 'out'), { recursive: true, force: true });
  }
});
