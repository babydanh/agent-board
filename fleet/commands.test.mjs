// The machine side of remote commands: fixed verbs, argv only, checked a second time before anything runs (design decisions 8-9).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadPendingResults, runCommand, runDelivered, savePendingResults } from './commands.mjs';

const NOW = 1_000_000_000_000;
const cmd = (verb, args, extra = {}) => ({ id: 'c1', verb, args, expires_at: NOW + 60_000, ...extra });
const base = (over = {}) => ({ machine: 'danh', now: () => NOW, lanes: () => ['/repo/wt'], snapshot: () => null, exec: () => '', ...over });

test('TC-CMDRUN-01: a snapshot command calls the snapshot code with the machine id and runs nothing through a shell', async () => {
  const seen = [];
  const result = await runCommand(cmd('snapshot-push', { path: '/repo/wt' }), base({ snapshot: (path, machine) => { seen.push([path, machine]); return { ref: 'refs/wip/danh/feat', commit: 'a'.repeat(40), omitted: [] }; } }));
  assert.deepEqual(seen, [['/repo/wt', 'danh']]);
  assert.equal(result.status, 'success');
  assert.equal(result.id, 'c1');
  assert.match(result.detail, /refs\/wip\/danh\/feat/);

  const calls = [];
  await runCommand(cmd('clean-worktree', { path: '/repo/wt' }), base({ exec: (args) => { calls.push(args); return args[2] === 'rev-parse' ? '/repo/wt/.git\n/repo/.git\n' : args.includes('for-each-ref') ? 'refs/remotes/origin/main\n' : args.includes('--show-current') ? 'feat\n' : ''; } }));
  assert.ok(calls.length > 0);
  for (const args of calls) assert.ok(Array.isArray(args) && args.every((a) => typeof a === 'string'), 'argv arrays of strings');
  assert.ok(calls.every((args) => args[0] === '-C' || args[0] === '--git-dir'), 'every call is git arguments, never a command line');
});

test('TC-CMDRUN-02: a protected branch, a bad path, an unknown verb, an expired command and a foreign path are refused without running anything', async () => {
  const ran = [];
  const deps = base({ snapshot: () => { ran.push('snapshot'); return null; }, exec: (args) => { ran.push(args); return ''; } });
  const refused = [
    cmd('staging-sync', { branch: 'main' }),
    cmd('staging-sync', { branch: 'origin/master' }),
    cmd('clean-worktree', { path: '/repo/wt', branch: 'production' }),
    cmd('snapshot-push', { path: '--upload-pack=x' }),
    cmd('rm-rf', {}),
    cmd('snapshot-push', { path: '/repo/wt' }, { expires_at: NOW - 1 }),
    cmd('snapshot-push', { path: '/somewhere/else' }),
  ];
  for (const command of refused) {
    const result = await runCommand(command, deps);
    assert.equal(result.status, 'refused', JSON.stringify(command));
  }
  assert.deepEqual(ran, []);
});

test('TC-CMDRUN-03: a second command while one is running is refused, and the first still finishes', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = runCommand(cmd('snapshot-push', { path: '/repo/wt' }, { id: 'one' }), base({ snapshot: () => gate.then(() => null) }));
  const second = await runCommand(cmd('snapshot-push', { path: '/repo/wt' }, { id: 'two' }), base());
  assert.equal(second.status, 'refused');
  assert.match(second.detail, /another command/);
  release();
  assert.equal((await first).status, 'success');
  assert.equal((await runCommand(cmd('snapshot-push', { path: '/repo/wt' }, { id: 'three' }), base())).status, 'success');
});

test('TC-CMDRUN-04: clean-worktree refuses a dirty tree, the main checkout and commits that are on no remote, and never passes a force flag', async () => {
  const exec = (state) => (args) => {
    if (args.includes('--git-common-dir')) return state.main ? '.git\n.git\n' : '/repo/wt/.git\n/repo/.git\n';
    if (args.includes('--show-current')) return 'feat\n';
    if (args.includes('status')) return state.dirty ? ' M a.ts\n' : '';
    if (args.includes('for-each-ref')) return state.remote ? 'refs/remotes/origin/main\n' : '';
    state.removed.push(args);
    return '';
  };
  const run = async (over) => {
    const state = { dirty: false, remote: true, main: false, removed: [], ...over };
    const result = await runCommand(cmd('clean-worktree', { path: '/repo/wt' }), base({ exec: exec(state) }));
    return { result, state };
  };
  assert.equal((await run({ dirty: true })).result.status, 'refused');
  assert.equal((await run({ main: true })).result.status, 'refused');
  assert.equal((await run({ remote: false })).result.status, 'refused');
  for (const bad of [{ dirty: true }, { main: true }, { remote: false }]) assert.equal((await run(bad)).state.removed.length, 0);

  const ok = await run({});
  assert.equal(ok.result.status, 'success');
  assert.equal(ok.state.removed.length, 1);
  assert.deepEqual(ok.state.removed[0].slice(-3), ['worktree', 'remove', '/repo/wt']);
  assert.ok(!ok.state.removed[0].some((a) => a === '--force' || a === '-f'));
});

test('TC-CMDRUN-05: with real git, a clean merged worktree is removed and a dirty one stays', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cmdrun-')));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env });
  const main = join(root, 'main');
  execFileSync('git', ['clone', '-q', origin, main], { env, stdio: 'ignore' });
  writeFileSync(join(main, 'a.txt'), 'a\n');
  g(main, 'add', 'a.txt');
  g(main, 'commit', '-q', '-m', 'one');
  g(main, 'push', '-q', 'origin', 'HEAD:main');
  g(main, 'fetch', '-q', 'origin');
  const clean = join(root, 'clean');
  const dirty = join(root, 'dirty');
  g(main, 'worktree', 'add', '-q', '-b', 'feat-clean', clean);
  g(main, 'worktree', 'add', '-q', '-b', 'feat-dirty', dirty);
  writeFileSync(join(dirty, 'new.txt'), 'x\n');

  const deps = base({ lanes: () => [main, clean, dirty], exec: (args) => execFileSync('git', args, { env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) });
  assert.equal((await runCommand(cmd('clean-worktree', { path: dirty }), deps)).status, 'refused');
  assert.ok(existsSync(dirty));
  assert.equal((await runCommand(cmd('clean-worktree', { path: main }), deps)).status, 'refused');
  assert.ok(existsSync(main));
  const done = await runCommand(cmd('clean-worktree', { path: clean }), deps);
  assert.equal(done.status, 'success', done.detail);
  assert.ok(!existsSync(clean));
});

test('TC-CMDRUN-06: verbs without an executor on this machine answer refused, never success', async () => {
  for (const [verb, args] of [['run-tests', { branch: 'feat/a' }], ['staging-sync', { branch: 'feat/a' }]]) {
    const result = await runCommand(cmd(verb, args), base());
    assert.equal(result.status, 'refused');
    assert.match(result.detail, /not available/);
  }
  const used = [];
  const result = await runCommand(cmd('staging-sync', { branch: 'feat/a' }), base({ executors: { 'staging-sync': (args) => { used.push(args); return 'synced'; } } }));
  assert.equal(result.status, 'success');
  assert.deepEqual(used, [{ branch: 'feat/a' }]);
});

test('TC-CMDRUN-07: pending results survive until they are sent, and a bad file reads as empty', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cmdres-')), 'results.json');
  assert.deepEqual(loadPendingResults(file), []);
  savePendingResults(file, [{ id: 'a', status: 'success', detail: 'ok' }]);
  assert.deepEqual(loadPendingResults(file), [{ id: 'a', status: 'success', detail: 'ok' }]);
  writeFileSync(file, '{not json');
  assert.deepEqual(loadPendingResults(file), []);
  savePendingResults(file, []);
  assert.equal(readFileSync(file, 'utf8'), '[]');
});

test('TC-CMDRUN-08: delivered commands run only when this machine opted in, and the file always ends holding just the new results', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cmddel-')), 'results.json');
  savePendingResults(file, [{ id: 'old', status: 'success', detail: 'already sent' }]);
  const off = await runDelivered([cmd('snapshot-push', { path: '/repo/wt' })], { enabled: false, file, deps: base({ snapshot: () => { throw new Error('must not run'); } }) });
  assert.deepEqual(off.map((r) => [r.id, r.status]), [['c1', 'refused']]);
  assert.match(off[0].detail, /off on this machine/);
  assert.deepEqual(loadPendingResults(file), off);

  const on = await runDelivered([cmd('snapshot-push', { path: '/repo/wt' })], { enabled: true, file, deps: base() });
  assert.deepEqual(on.map((r) => r.status), ['success']);
  assert.deepEqual(loadPendingResults(file), on);

  assert.deepEqual(await runDelivered(undefined, { enabled: true, file, deps: base() }), []);
  assert.deepEqual(loadPendingResults(file), []);
});
