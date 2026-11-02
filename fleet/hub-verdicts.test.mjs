// Hub side of the exact overlap verdicts: who judges a repository, and what a judge may store.
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
const ids = ['danh', 'danh1', 'local-pc', 'board'];
const keys = Object.fromEntries(ids.map((id) => [id, pair()]));
const dir = mkdtempSync(join(tmpdir(), 'fleet-verdicts-'));
const keysPath = join(dir, 'keys.json');
writeFileSync(keysPath, JSON.stringify(Object.fromEntries(ids.map((id) => [id, { pub: keys[id].pub, role: id === 'board' ? 'read' : 'report' }]))));

const clock = { now: 1_000_000_000_000 };
const server = createHub({ keysPath, statePath: join(dir, 'state.json'), now: () => clock.now, startedAt: 0 });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const token = (id, role = 'report') => signJwt({ iss: id, aud: 'fleet-hub', role }, keys[id].priv, 300, clock.now);
const post = async (id, body) => {
  clock.now += 1000;
  const response = await fetch(`${base}/v1/report`, { method: 'POST', headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: id, ...body }) });
  return { status: response.status, json: await response.json() };
};
const fleet = async () => (await fetch(`${base}/v1/fleet`, { headers: { Authorization: `Bearer ${token('board', 'read')}` } })).json();
const withRepo = (githubRepo, extra = {}) => ({ repos: [{ path: '/x', branch: 'b', github_repo: githubRepo, ...extra }] });
const verdict = (extra = {}) => ({ repo: 'o/r', a: 'danh/topic', b: 'local-pc/topic', file: 'a.ts', status: 'conflict', ranges: [[1, 3]], ...extra });

test('TC-VERDICT-01: the lowest online cloud machine holding the repository is told to judge it', async () => {
  await post('local-pc', withRepo('o/one'));
  await post('danh1', withRepo('o/one'));
  const first = await post('danh', withRepo('o/one'));
  const second = await post('danh1', withRepo('o/one'));
  assert.deepEqual(first.json.judge, ['o/one']);
  assert.deepEqual(second.json.judge, []);
});

test('TC-VERDICT-02: a repository reported by one machine, or only by local reporters, has no judge', async () => {
  await post('danh', withRepo('o/solo'));
  assert.deepEqual((await post('danh', withRepo('o/solo'))).json.judge, []);
  await post('local-pc', withRepo('o/localonly'));
  assert.deepEqual((await post('local-pc', withRepo('o/localonly'))).json.judge, []);
});

test('TC-VERDICT-03: when the lowest id goes silent, the next online cloud machine takes over', async () => {
  await post('danh', withRepo('o/two'));
  await post('danh1', withRepo('o/two'));
  assert.deepEqual((await post('danh1', withRepo('o/two'))).json.judge, []);
  clock.now += 11 * 60 * 1000;
  assert.deepEqual((await post('danh1', withRepo('o/two'))).json.judge, ['o/two']);
});

test('TC-VERDICT-04: verdicts are validated, bounded and served to the board; bad entries are dropped, not the report', async () => {
  const many = Array.from({ length: 500 }, (_, i) => verdict({ file: `f${i}.ts` }));
  const bad = [
    verdict({ status: 'clean' }), verdict({ file: 7 }), verdict({ a: '' }), verdict({ ranges: 'x' }), null, 'text',
    verdict({ file: 'x'.repeat(2000), ranges: Array.from({ length: 50 }, (_, i) => [i + 1, i + 2]) }),
  ];
  assert.equal((await post('danh', { ...withRepo('o/v'), verdicts: [...bad, ...many] })).status, 200);
  const { machines } = await fleet();
  const stored = machines.find((m) => m.agent_id === 'danh').verdicts;
  assert.equal(stored.length, 200);
  assert.ok(stored.every((v) => ['conflict', 'auto', 'incomplete'].includes(v.status)));
  assert.equal(stored[0].file.length, 500);
  assert.equal(stored[0].ranges.length, 20);
});

test('TC-VERDICT-05: a report without verdicts clears the machine\'s old ones', async () => {
  await post('danh', { ...withRepo('o/v'), verdicts: [verdict()] });
  await post('danh', withRepo('o/v'));
  const { machines } = await fleet();
  assert.deepEqual(machines.find((m) => m.agent_id === 'danh').verdicts, []);
});
