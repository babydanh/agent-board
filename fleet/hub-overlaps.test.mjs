// The hub tells each machine which of its edited files another online machine is editing too (TC-OVERLAPHUB).
// (Kept apart from hub.test.mjs, which other lanes edit.)
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createHub } from './hub.mjs';
import { signJwt } from './jwt.mjs';

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const ids = ['danh', 'danh1', 'danh2', 'local-pc'];
const keys = Object.fromEntries(ids.map((id) => [id, pair()]));
const dir = mkdtempSync(join(tmpdir(), 'fleet-overlaps-'));
const keysPath = join(dir, 'keys.json');
writeFileSync(keysPath, JSON.stringify(Object.fromEntries(ids.map((id) => [id, { pub: keys[id].pub, role: 'report' }]))));

const clock = { now: 1_000_000_000_000 };
const server = createHub({ keysPath, statePath: join(dir, 'state.json'), now: () => clock.now, startedAt: 0 });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const post = async (id, repos) => {
  clock.now += 1000;
  const token = signJwt({ iss: id, aud: 'fleet-hub', role: 'report' }, keys[id].priv, 300, clock.now);
  const response = await fetch(`${base}/v1/report`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id, repos }) });
  return (await response.json()).overlaps;
};
const row = (githubRepo, dirty, changes = []) => ({ path: '/x', branch: 'b', github_repo: githubRepo, dirty_files: dirty, changes: changes.map((path) => ({ path, ranges: [[1, 2]] })) });

test('TC-OVERLAPHUB-01: a file two machines edit is named to each of them, with the other machines only', async () => {
  await post('danh', [row('o/a', ['x.ts', 'only-danh.ts'])]);
  await post('danh1', [row('o/a', [], ['x.ts'])]);
  const mine = await post('danh', [row('o/a', ['x.ts', 'only-danh.ts'])]);
  assert.deepEqual(mine, [{ repo: 'o/a', file: 'x.ts', machines: ['danh1'] }]);
  const theirs = await post('danh1', [row('o/a', [], ['x.ts'])]);
  assert.deepEqual(theirs, [{ repo: 'o/a', file: 'x.ts', machines: ['danh'] }]);
});

test('TC-OVERLAPHUB-02: another repository, a silent machine and a machine\'s own files never count', async () => {
  await post('danh2', [row('o/b', ['y.ts'])]);
  assert.deepEqual(await post('danh', [row('o/c', ['y.ts'])]), []);
  clock.now += 11 * 60 * 1000;
  assert.deepEqual(await post('danh', [row('o/b', ['y.ts'])]), []);
});

test('TC-OVERLAPHUB-03: a local reporter counts, and a file shared by two other machines names both', async () => {
  await post('local-pc', [row('o/d', ['z.ts'])]);
  await post('danh1', [row('o/d', ['z.ts'])]);
  const overlaps = await post('danh', [row('o/d', ['z.ts'])]);
  assert.deepEqual(overlaps, [{ repo: 'o/d', file: 'z.ts', machines: ['danh1', 'local-pc'] }]);
});
