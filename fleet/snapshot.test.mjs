// Snapshots: a lane (HEAD plus its uncommitted files) becomes a commit under refs/wip/<machine>/<lane> on the remote.
// The checkout itself (index, working tree, HEAD) must never change, and nothing but that namespace may be written.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertWipRef, pruneSnapshots, pushWipRef, snapshotLane, wipRef } from './snapshot.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const fakeToken = (prefix, length) => prefix + 'a'.repeat(length);

/** An origin with `main`, and a clone on branch `topic` one commit ahead of it. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'snapshot-'));
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'init', '-q', '-b', 'main', seed);
  writeFileSync(join(seed, 'a.txt'), 'one\ntwo\n');
  git(seed, 'add', 'a.txt');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', origin, 'main');
  git(base, 'clone', '-q', origin, clone);
  git(clone, 'checkout', '-q', '-b', 'topic');
  writeFileSync(join(clone, 'a.txt'), 'one\ntwo\nthree\n');
  git(clone, 'commit', '-q', '-am', 'topic work');
  return { origin, clone };
}

const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** Everything a snapshot must leave alone. `status` runs first: it may refresh the index, which is then hashed. */
const checkoutState = (clone) => {
  const status = git(clone, 'status', '--porcelain');
  return {
    status,
    head: git(clone, 'rev-parse', 'HEAD'),
    index: hashFile(join(clone, '.git', 'index')),
    file: readFileSync(join(clone, 'a.txt'), 'utf8'),
  };
};

const recordPush = () => {
  const pushes = [];
  return { pushes, push: (_path, commit, ref) => { pushes.push({ commit, ref }); } };
};

test('TC-SNAPSHOT-01: the real index, working tree and HEAD are byte-identical before and after', () => {
  const { clone } = fixture();
  writeFileSync(join(clone, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  writeFileSync(join(clone, 'new.txt'), 'brand new\n');
  const before = checkoutState(clone);
  const { push } = recordPush();
  const result = snapshotLane(clone, 'danh', { push, now: () => 1_000_000 });
  assert.ok(result?.commit);
  assert.deepEqual(checkoutState(clone), before);
});

test('TC-SNAPSHOT-02: an unchanged lane is not pushed twice', () => {
  const { clone } = fixture();
  writeFileSync(join(clone, 'new.txt'), 'x\n');
  const { pushes, push } = recordPush();
  assert.ok(snapshotLane(clone, 'danh', { push, now: () => 1_000_000 }));
  assert.equal(snapshotLane(clone, 'danh', { push, now: () => 9_000_000 }), null);
  assert.equal(pushes.length, 1);
});

test('TC-SNAPSHOT-03: only refs/wip/<machine>/<lane> can be written; anything else is refused', () => {
  assert.equal(wipRef('danh', 'fix/board-x'), 'refs/wip/danh/fix-board-x');
  assert.throws(() => wipRef('danh', '..'), /lane/);
  assert.throws(() => wipRef('Bad Machine', 'topic'), /machine/);
  for (const ref of ['refs/heads/main', 'refs/heads/master', 'main', 'refs/wip/danh', 'refs/wip/danh/../heads/main', 'refs/tags/v1']) {
    assert.throws(() => assertWipRef(ref), /refs\/wip/, ref);
  }
  assert.throws(() => pushWipRef('/nowhere', 'abc', 'refs/heads/main'), /refs\/wip/);
});

test('TC-SNAPSHOT-04: a lane is pushed at most once per minute, and again after it', () => {
  const { clone } = fixture();
  const { pushes, push } = recordPush();
  writeFileSync(join(clone, 'new.txt'), 'x\n');
  assert.ok(snapshotLane(clone, 'danh', { push, now: () => 1_000_000 }));
  writeFileSync(join(clone, 'new.txt'), 'y\n');
  assert.equal(snapshotLane(clone, 'danh', { push, now: () => 1_030_000 }), null);
  assert.ok(snapshotLane(clone, 'danh', { push, now: () => 1_061_000 }));
  assert.equal(pushes.length, 2);
});

test('TC-SNAPSHOT-05: a secret file is left out of the snapshot and listed, the rest goes', () => {
  const { clone } = fixture();
  writeFileSync(join(clone, '.env'), 'TOKEN=abc\n');
  writeFileSync(join(clone, 'ok.txt'), 'fine\n');
  const { push } = recordPush();
  const result = snapshotLane(clone, 'danh', { push, now: () => 1_000_000 });
  assert.deepEqual(result.omitted, [{ path: '.env', reason: 'secret-name' }]);
  const files = git(clone, 'ls-tree', '-r', '--name-only', result.commit).split('\n');
  assert.ok(files.includes('ok.txt'));
  assert.ok(!files.includes('.env'));
});

test('TC-SNAPSHOT-06: a token-shaped line already committed on the lane blocks the whole push', () => {
  const { clone } = fixture();
  writeFileSync(join(clone, 'leak.ts'), `const k = "${fakeToken('gh' + 'p_', 36)}";\n`);
  git(clone, 'add', 'leak.ts');
  git(clone, 'commit', '-q', '-m', 'oops');
  const { pushes, push } = recordPush();
  const result = snapshotLane(clone, 'danh', { push, now: () => 1_000_000 });
  assert.equal(result.ref, null);
  assert.deepEqual(result.omitted, [{ path: 'leak.ts', reason: 'secret-text' }]);
  assert.equal(pushes.length, 0);
});

test('TC-SNAPSHOT-07: a real push lands under refs/wip and leaves every branch of the remote alone', () => {
  const { origin, clone } = fixture();
  writeFileSync(join(clone, 'new.txt'), 'x\n');
  const headsBefore = git(origin, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads');
  const result = snapshotLane(clone, 'danh', { now: () => 1_000_000 });
  assert.equal(git(origin, 'rev-parse', 'refs/wip/danh/topic'), result.commit);
  assert.equal(git(origin, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), headsBefore);
});

test('TC-SNAPSHOT-08: a clean lane level with the default branch has nothing to share', () => {
  const { clone } = fixture();
  git(clone, 'checkout', '-q', '-b', 'idle', 'origin/main');
  const { pushes, push } = recordPush();
  assert.equal(snapshotLane(clone, 'danh', { push, now: () => 1_000_000 }), null);
  assert.equal(pushes.length, 0);
});

test('TC-SNAPSHOT-09: a lane with commits only is shared as its own HEAD, with no extra commit', () => {
  const { origin, clone } = fixture();
  const result = snapshotLane(clone, 'danh', { now: () => 1_000_000 });
  assert.equal(result.commit, git(clone, 'rev-parse', 'HEAD'));
  assert.equal(git(origin, 'rev-parse', 'refs/wip/danh/topic'), result.commit);
});

test('TC-SNAPPRUNE-01: snapshot refs older than the limit are deleted from the remote, newer ones and other machines are left alone', () => {
  const { origin, clone } = fixture();
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  // Three pushes at different times, as the snapshot state records them.
  const head = git(clone, 'rev-parse', 'HEAD');
  for (const ref of ['refs/wip/danh/old', 'refs/wip/danh/new', 'refs/wip/other/old']) git(clone, 'push', '-q', origin, `${head}:${ref}`);
  const stateFile = join(git(clone, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'fleet-snapshot-state.json');
  writeFileSync(stateFile, JSON.stringify({
    'refs/wip/danh/old': { key: 'k', at: now - 20 * day, commit: head },
    'refs/wip/danh/new': { key: 'k', at: now - 1 * day, commit: head },
    'refs/wip/other/old': { key: 'k', at: now - 20 * day, commit: head },
  }));
  const removed = pruneSnapshots(clone, 'danh', { now: () => now });
  assert.deepEqual(removed, ['refs/wip/danh/old']);
  const remote = git(clone, 'ls-remote', origin, 'refs/wip/*');
  assert.ok(!remote.includes('refs/wip/danh/old'));
  assert.ok(remote.includes('refs/wip/danh/new'));
  assert.ok(remote.includes('refs/wip/other/old'), 'another machine\'s namespace is never touched');
  assert.ok(git(clone, 'ls-remote', origin, 'refs/heads/main').includes('refs/heads/main'));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(stateFile, 'utf8'))).sort(), ['refs/wip/danh/new', 'refs/wip/other/old']);
  // Nothing due: nothing is pushed and the answer is empty.
  assert.deepEqual(pruneSnapshots(clone, 'danh', { now: () => now, remove: () => { throw new Error('must not delete'); } }), []);
});

test('TC-SNAPPRUNE-02: a delete that fails keeps the entry so the next run tries again, and never targets a branch', () => {
  const { clone } = fixture();
  const day = 24 * 60 * 60 * 1000;
  const stateFile = join(git(clone, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'fleet-snapshot-state.json');
  writeFileSync(stateFile, JSON.stringify({
    'refs/wip/danh/old': { key: 'k', at: 0, commit: 'x' },
    'refs/heads/main': { key: 'k', at: 0, commit: 'x' },
  }));
  const asked = [];
  const removed = pruneSnapshots(clone, 'danh', { now: () => 30 * day, remove: (_path, ref) => { asked.push(ref); throw new Error('offline'); } });
  assert.deepEqual(removed, []);
  assert.deepEqual(asked, ['refs/wip/danh/old']);
  assert.ok('refs/wip/danh/old' in JSON.parse(readFileSync(stateFile, 'utf8')));
});

test('TC-SNAPPRUNE-03: a ref that is already gone from the remote counts as removed, so it is not retried forever', () => {
  const { clone } = fixture();
  const stateFile = join(git(clone, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'fleet-snapshot-state.json');
  writeFileSync(stateFile, JSON.stringify({ 'refs/wip/danh/gone': { key: 'k', at: 0, commit: 'x' } }));
  assert.deepEqual(pruneSnapshots(clone, 'danh', { now: () => 30 * 24 * 60 * 60 * 1000 }), ['refs/wip/danh/gone']);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), {});
});
