// contentIn answers "is this checkout's content already in <ref>?". The merge-tree behind it is the slowest step of a
// report (seconds per checkout on a weak machine), so an answer must be reused while neither HEAD nor the ref moved.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { contentIn, git } from './agent.mjs';

const gitIn = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** A checkout with an `origin/main` ref and a topic branch one commit ahead of it. */
function topicAheadOfMain() {
  const dir = mkdtempSync(join(tmpdir(), 'content-in-'));
  gitIn(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  gitIn(dir, 'add', 'a.txt');
  gitIn(dir, 'commit', '-q', '-m', 'base');
  gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  gitIn(dir, 'checkout', '-q', '-b', 'topic');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  gitIn(dir, 'commit', '-q', '-am', 'topic');
  return dir;
}

/** `git` that counts how many merge-tree runs it was asked for. */
function countingGit() {
  const counter = { mergeTrees: 0 };
  const run = (path, ...args) => {
    if (args[0] === 'merge-tree') counter.mergeTrees += 1;
    return git(path, ...args);
  };
  return { counter, run };
}

test('TC-CONTENTIN-01: the second answer for the same HEAD and ref reuses the first and runs no merge-tree', () => {
  const dir = topicAheadOfMain();
  const { counter, run } = countingGit();
  assert.equal(contentIn(dir, 'origin/main', run), false);
  assert.equal(contentIn(dir, 'origin/main', run), false);
  assert.equal(counter.mergeTrees, 1);
});

test('TC-CONTENTIN-02: a moved ref is measured again, so a merge that lands later flips the answer', () => {
  const dir = topicAheadOfMain();
  const { counter, run } = countingGit();
  assert.equal(contentIn(dir, 'origin/main', run), false);
  gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(contentIn(dir, 'origin/main', run), true);
  assert.equal(counter.mergeTrees, 2);
});

test('TC-CONTENTIN-03: a new commit on the checkout is measured again', () => {
  const dir = topicAheadOfMain();
  const { counter, run } = countingGit();
  assert.equal(contentIn(dir, 'origin/main', run), false);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  gitIn(dir, 'commit', '-q', '-am', 'more');
  assert.equal(contentIn(dir, 'origin/main', run), false);
  assert.equal(counter.mergeTrees, 2);
});

test('TC-CONTENTIN-04: a missing ref is false and never cached as a success', () => {
  const dir = topicAheadOfMain();
  assert.equal(contentIn(dir, 'origin/staging'), false);
  gitIn(dir, 'update-ref', 'refs/remotes/origin/staging', 'HEAD');
  assert.equal(contentIn(dir, 'origin/staging'), true);
});
