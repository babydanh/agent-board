// The overlap file a machine writes beside its repository for the in-session warning (TC-OVERLAPFILE).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { overlapLanes, writeOverlapFiles } from './overlapFile.mjs';

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-overlap-file-'));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
};
const read = (dir) => JSON.parse(readFileSync(join(dir, '.git', 'fleet-overlap.json'), 'utf8'));

test('TC-OVERLAPFILE-01: one lane per other machine, in the same shape as overlap-lanes.json', () => {
  const dir = repo();
  writeOverlapFiles([{ path: dir, github_repo: 'o/a' }], [
    { repo: 'o/a', file: 'a.ts', machines: ['danh1'] },
    { repo: 'o/a', file: 'b.ts', machines: ['danh1', 'danh2'] },
    { repo: 'o/other', file: 'c.ts', machines: ['danh3'] },
  ]);
  assert.deepEqual(read(dir).lanes, [
    { path: 'fleet:danh1', branch: null, mb: '', files: ['a.ts', 'b.ts'], new: [] },
    { path: 'fleet:danh2', branch: null, mb: '', files: ['b.ts'], new: [] },
  ]);
});

test('TC-OVERLAPFILE-02: no overlaps clears the file, and a path that is not a repository is skipped without throwing', () => {
  const dir = repo();
  writeOverlapFiles([{ path: dir, github_repo: 'o/a' }], [{ repo: 'o/a', file: 'a.ts', machines: ['danh1'] }]);
  writeOverlapFiles([{ path: dir, github_repo: 'o/a' }, { path: join(dir, 'nope'), github_repo: 'o/a' }], []);
  assert.deepEqual(read(dir).lanes, []);
});

test('TC-OVERLAPFILE-03: a worktree writes into its main repository\'s .git, once, and rows without a GitHub repository write nothing', () => {
  const dir = repo();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'f'), '');
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i']);
  const wt = join(mkdtempSync(join(tmpdir(), 'fleet-overlap-wt-')), 'wt');
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'w', wt]);
  writeOverlapFiles([{ path: wt, github_repo: 'o/a' }, { path: dir, github_repo: 'o/a' }, { path: join(dir, 'sub') }], [{ repo: 'o/a', file: 'a.ts', machines: ['danh1'] }]);
  assert.equal(read(dir).lanes.length, 1);
  assert.equal(existsSync(join(wt, '.git', 'fleet-overlap.json')), false);
});

test('overlapLanes returns nothing for a repository nobody else touches', () => {
  assert.deepEqual(overlapLanes([{ repo: 'o/x', file: 'a.ts', machines: ['danh1'] }], 'o/a'), []);
});

test('TC-OVERLAPFILE-04: a cloud machine and a local reporter editing one file learn of each other through a real hub', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { createHub } = await import('./hub.mjs');
  const { sendReport } = await import('./local-agent.mjs');
  const pair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  };
  const cloud = pair(), local = pair();
  const dir = mkdtempSync(join(tmpdir(), 'overlap-e2e-'));
  const keysPath = join(dir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ danh: { pub: cloud.pub, role: 'report' }, 'local-pc': { pub: local.pub, role: 'report' } }));
  const hub = createHub({ keysPath, statePath: join(dir, 'state.json') });
  await new Promise((resolve) => hub.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${hub.address().port}`;
    const viaHub = (input, init) => fetch(new URL(new URL(String(input)).pathname, url), init);
    const keyOf = (id, pem) => { const keyPath = join(dir, `${id}.pem`); writeFileSync(keyPath, pem); return { hub: 'https://hub.example', keyPath, id }; };
    const mine = repo();
    const row = (path) => ({ path, branch: 'b', github_repo: 'o/a', dirty_files: ['shared.ts'], changes: [] });
    await sendReport(keyOf('danh', cloud.priv), { agent_id: 'danh', repos: [row('/cloud/wt')] }, viaHub);
    const reply = await sendReport(keyOf('local-pc', local.priv), { agent_id: 'local-pc', repos: [row(mine)] }, viaHub);
    writeOverlapFiles([row(mine)], reply.overlaps);
    assert.deepEqual(read(mine).lanes, [{ path: 'fleet:danh', branch: null, mb: '', files: ['shared.ts'], new: [] }]);
  } finally {
    hub.close();
  }
});
