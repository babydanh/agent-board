// Hub side of the command queue (design decisions 8-9): who may queue, what a machine receives, expiry and the audit trail.
// (Kept apart from hub.test.mjs, which other lanes edit.)
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createHub } from './hub.mjs';
import { signJwt } from './jwt.mjs';

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
// Each test owns its machines: a command left queued by one test must not reach another.
const roles = { m1: 'report', m2: 'report', a: 'report', b: 'report', m4: 'report', m5: 'report', m6: 'report', board: 'read', boss: 'command' };
const keys = Object.fromEntries(Object.keys(roles).map((id) => [id, pair()]));
const dir = mkdtempSync(join(tmpdir(), 'fleet-commands-'));
const keysPath = join(dir, 'keys.json');
writeFileSync(keysPath, JSON.stringify(Object.fromEntries(Object.entries(roles).map(([id, role]) => [id, { pub: keys[id].pub, role }]))));
const statePath = join(dir, 'state.json');

const clock = { now: 1_000_000_000_000 };
const server = createHub({ keysPath, statePath, now: () => clock.now, startedAt: 0 });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const token = (id) => signJwt({ iss: id, aud: 'fleet-hub', role: roles[id] }, keys[id].priv, 300, clock.now);
const call = (method, path, id, body) =>
  fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const report = async (id, extra = {}) => (await call('POST', '/v1/report', id, { agent_id: id, repos: [], ...extra })).json();
const queue = (id, cmd) => call('POST', '/v1/commands', id, cmd);
const history = async () => (await (await call('GET', '/v1/commands', 'board')).json()).commands;
const snapshot = (target, path = '/repo/wt') => ({ target, verb: 'snapshot-push', args: { path } });

test('TC-CMDQ-01: a machine key and a read key cannot queue a command', async () => {
  await report('m1');
  assert.equal((await queue('m1', snapshot('m1'))).status, 401);
  assert.equal((await queue('board', snapshot('m1'))).status, 401);
  assert.equal((await queue('boss', snapshot('m1'))).status, 200);
});

test('TC-CMDQ-02: an unknown verb, a bad argument, an unknown machine and a protected branch are refused', async () => {
  await report('m2');
  const refused = [
    { target: 'm2', verb: 'rm-rf', args: {} },
    { target: 'm2', verb: 'snapshot-push', args: { path: '--upload-pack=x' } },
    { target: 'm2', verb: 'snapshot-push', args: {} },
    { target: 'nobody', verb: 'snapshot-push', args: { path: '/repo/wt' } },
    { target: 'm2', verb: 'staging-sync', args: { branch: 'main' } },
    { target: 'm2', verb: 'staging-sync', args: { branch: 'refs/heads/production' } },
    { target: 'm2', verb: 'staging-sync', args: { branch: 'origin/master' } },
    { target: 'm2', verb: 'run-tests', args: { branch: 'feat/a b' } },
  ];
  for (const cmd of refused) assert.equal((await queue('boss', cmd)).status, 400, JSON.stringify(cmd));
  assert.equal((await queue('boss', { target: 'm2', verb: 'staging-sync', args: { branch: 'feat/a' } })).status, 200);
});

test('TC-CMDQ-03: a machine receives only its own commands, one at a time, and only the fields it needs', async () => {
  await report('a');
  await report('b');
  const mine = await (await queue('boss', snapshot('b', '/repo/mine'))).json();
  const reply1 = await report('a');
  assert.ok(!reply1.commands.some((c) => c.id === mine.id));
  const reply = await report('b');
  const got = reply.commands.find((c) => c.id === mine.id);
  assert.deepEqual(Object.keys(got).sort(), ['args', 'expires_at', 'id', 'verb']);
  assert.equal(got.verb, 'snapshot-push');
  const second = await (await queue('boss', snapshot('b', '/repo/second'))).json();
  assert.ok(!(await report('b')).commands.some((c) => c.id === second.id), 'second waits for the first result');
  const afterResult = await report('b', { results: [{ id: mine.id, status: 'success', detail: 'ok' }] });
  assert.ok(afterResult.commands.some((c) => c.id === second.id), 'the reply to a result carries the next command');
});

test('TC-CMDQ-04: a second fetch does not hand out the same command again, and a duplicate result is ignored', async () => {
  await report('m4');
  const { id } = await (await queue('boss', snapshot('m4', '/repo/once'))).json();
  const first = (await report('m4')).commands.map((c) => c.id);
  assert.ok(first.includes(id));
  assert.ok(!(await report('m4')).commands.some((c) => c.id === id));
  await report('m4', { results: [{ id, status: 'success', detail: 'first' }] });
  await report('m4', { results: [{ id, status: 'failed', detail: 'second' }] });
  const row = (await history()).find((c) => c.id === id);
  assert.equal(row.state, 'success');
  assert.equal(row.result.detail, 'first');
});

test('TC-CMDQ-05: a command nobody fetched in time expires and is never delivered; a stuck delivery expires too', async () => {
  await report('m5');
  const late = await (await queue('boss', snapshot('m5', '/repo/late'))).json();
  clock.now += 11 * 60 * 1000;
  assert.ok(!(await report('m5')).commands.some((c) => c.id === late.id));
  assert.equal((await history()).find((c) => c.id === late.id).state, 'expired');

  const stuck = await (await queue('boss', snapshot('m5', '/repo/stuck'))).json();
  assert.ok((await report('m5')).commands.some((c) => c.id === stuck.id));
  clock.now += 16 * 60 * 1000;
  await report('m5');
  assert.equal((await history()).find((c) => c.id === stuck.id).state, 'expired');
});

test('TC-CMDQ-06: a result for another machine or an unknown id changes nothing, and the audit file records every state change', async () => {
  await report('m6');
  const { id } = await (await queue('boss', snapshot('m6', '/repo/audit'))).json();
  await report('m6');
  await report('b', { results: [{ id, status: 'success', detail: 'not mine' }] });
  assert.equal((await history()).find((c) => c.id === id).state, 'delivered');
  await report('m6', { results: [{ id, status: 'failed', detail: 'x'.repeat(2000) }, { id: 'nope', status: 'success', detail: '' }] });
  const row = (await history()).find((c) => c.id === id);
  assert.equal(row.state, 'failed');
  assert.ok(row.result.detail.length <= 500);

  const lines = readFileSync(`${statePath}.audit.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.id === id);
  assert.deepEqual(lines.map((entry) => entry.state), ['queued', 'delivered', 'failed']);
  assert.ok(lines.every((entry) => entry.target === 'm6' && entry.verb === 'snapshot-push' && Number.isFinite(entry.at)));
  assert.equal(lines[0].by, 'boss');
});
