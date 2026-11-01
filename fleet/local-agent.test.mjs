import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createHub } from './hub.mjs';
import { signJwt } from './jwt.mjs';
import { buildReport, ensureKey, localAgentId, parseConfig, parseWorktreeList, repoRow, sendReport } from './local-agent.mjs';

const tmp = (name) => mkdtempSync(join(tmpdir(), `${name}-`));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });

test('TC-LOCALAGENT-01: the id keeps only characters the hub and the board accept', () => {
  assert.equal(localAgentId('DESKTOP-6G1153O'), 'local-desktop-6g1153o');
  assert.equal(localAgentId('Máy Của Danh!'), 'local-m-y-c-a-danh');
  assert.equal(localAgentId('***'), 'local-pc');
  assert.match(localAgentId('x'.repeat(100)), /^local-[a-z0-9-]{1,33}$/);
});

test('TC-LOCALAGENT-02: config is validated before anything runs', () => {
  const ok = parseConfig(JSON.stringify({ hub: 'https://hub.example.com/path', keyPath: 'k.pem', roots: ['V:/a'], id: 'local-pc' }));
  assert.deepEqual(ok, { hub: 'https://hub.example.com', keyPath: 'k.pem', roots: ['V:/a'], id: 'local-pc' });
  assert.throws(() => parseConfig('not json'), /valid JSON/);
  assert.throws(() => parseConfig(JSON.stringify({ hub: 'http://hub', roots: ['a'] })), /https/);
  assert.throws(() => parseConfig(JSON.stringify({ hub: 'https://hub', roots: [] })), /roots/);
  assert.throws(() => parseConfig(JSON.stringify({ hub: 'https://hub', roots: ['a'], id: 'Bad Id' })), /config.id/);
});

test('TC-LOCALAGENT-03: worktree list skips bare and prunable entries', () => {
  const porcelain = [
    'worktree V:/repo\nHEAD abc\nbranch refs/heads/main',
    'worktree V:/repo/.worktrees/a\nHEAD def\nbranch refs/heads/a',
    'worktree V:/gone\nHEAD 111\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location',
    'worktree V:/bare.git\nbare',
  ].join('\n\n');
  assert.deepEqual(parseWorktreeList(porcelain), ['V:/repo', 'V:/repo/.worktrees/a']);
});

test('TC-LOCALAGENT-04: a real repository row names the branch and the dirty paths, never content', () => {
  const dir = tmp('local-agent-repo');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'first');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(dir, 'b.txt'), 'new\n');

  const row = repoRow(dir);

  assert.equal(row.branch, 'main');
  assert.deepEqual([...row.dirty_files].sort(), ['a.txt', 'b.txt']);
  assert.equal(row.ahead, 0);
  assert.equal(JSON.stringify(row).includes('two'), false);
});

test('TC-BASE-DEFAULT-04: a row measures against the repository default branch, not origin/main', () => {
  const base = tmp('local-agent-default');
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  git(base, 'init', '-q', '--bare', '-b', 'master', origin);
  git(base, 'init', '-q', '-b', 'master', seed);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  git(seed, 'add', 'a.txt');
  git(seed, 'commit', '-q', '-m', 'master');
  git(seed, 'push', '-q', origin, 'master');
  git(seed, 'checkout', '-q', '--orphan', 'main');
  git(seed, 'rm', '-q', '-rf', '.');
  writeFileSync(join(seed, 'other.txt'), 'unrelated\n');
  git(seed, 'add', 'other.txt');
  git(seed, 'commit', '-q', '-m', 'unrelated main');
  git(seed, 'push', '-q', origin, 'main');
  git(base, 'clone', '-q', origin, clone);
  git(clone, 'checkout', '-q', '-b', 'stable', 'origin/master');

  const row = repoRow(clone);

  assert.equal(row.origin_main, git(clone, 'rev-parse', 'origin/master').trim());
  assert.notEqual(row.origin_main, git(clone, 'rev-parse', 'origin/main').trim());
  assert.equal(row.merged, true);
  assert.deepEqual(row.changes, []);
});

test('TC-LOCALAGENT-05: a worktree listed twice is reported once, and a missing folder is skipped', () => {
  const dir = tmp('local-agent-dedupe');
  const report = buildReport(
    { id: 'local-pc', roots: ['r1', 'r2'] },
    (path) => ({ path, repo: 'r', branch: 'b', dirty_files: [], changes: [] }),
    (root) => (root === 'r1' ? [dir, join(dir, 'missing')] : [dir]),
  );
  assert.deepEqual(report.repos.map((row) => row.path), [dir]);
  assert.equal(report.agent_id, 'local-pc');
  assert.equal(report.guard, null);
});

test('TC-LOCALAGENT-06: the key is created once with owner-only mode and never replaced', () => {
  const keyPath = join(tmp('local-agent-key'), 'k.pem');
  const first = ensureKey(keyPath);
  const privateBefore = readFileSync(keyPath, 'utf8');
  assert.match(first, /BEGIN PUBLIC KEY/);
  assert.equal(first.includes('PRIVATE'), false);
  assert.equal(ensureKey(keyPath), first);
  assert.equal(readFileSync(keyPath, 'utf8'), privateBefore);
  if (process.platform !== 'win32') assert.equal(statSync(keyPath).mode & 0o077, 0);
});

test('TC-LOCALAGENT-07: a report reaches a real hub under its own key, and the board key reads it back', async () => {
  const dir = tmp('local-agent-hub');
  const localKey = join(dir, 'local.pem');
  const localPub = ensureKey(localKey);
  const board = generateKeyPairSync('ed25519');
  const keysPath = join(dir, 'keys.json');
  writeFileSync(
    keysPath,
    JSON.stringify({
      'local-pc': { pub: localPub, role: 'report' },
      board: { pub: board.publicKey.export({ type: 'spki', format: 'pem' }), role: 'read' },
    }),
  );
  const hub = createHub({ keysPath, statePath: join(dir, 'state.json') });
  await new Promise((resolve) => hub.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${hub.address().port}`;
  try {
    const report = buildReport(
      { id: 'local-pc', roots: ['r'] },
      (path) => ({ path, repo: 'pixel-agents', branch: 'feat/x', dirty_files: ['server/a.ts'], changes: [] }),
      () => [dir],
    );
    await sendReport({ hub: base, keyPath: localKey, id: 'local-pc' }, report);

    const read = signJwt({ iss: 'board', aud: 'fleet-hub', role: 'read' }, board.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const fleet = await (await fetch(`${base}/v1/fleet`, { headers: { Authorization: `Bearer ${read}` } })).json();
    const machine = fleet.machines.find((entry) => entry.agent_id === 'local-pc');
    assert.deepEqual(machine.repos[0].dirty_files, ['server/a.ts']);

    // The report key cannot read the fleet, and an unknown id cannot report.
    const asReport = signJwt({ iss: 'local-pc', aud: 'fleet-hub', role: 'read' }, readFileSync(localKey, 'utf8'));
    assert.equal((await fetch(`${base}/v1/fleet`, { headers: { Authorization: `Bearer ${asReport}` } })).status, 401);
    await assert.rejects(sendReport({ hub: base, keyPath: localKey, id: 'someone-else' }, { ...report, agent_id: 'someone-else' }), /hub 401/);
  } finally {
    hub.close();
  }
});
