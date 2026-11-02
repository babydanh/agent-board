// The local reporter repeats its scan every cycle. A checkout that did not move must cost one `git status` and a few
// stat calls, not a full re-measure (~15-20 git calls).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createLaneScanner, lanePrint } from './laneScan.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repoWithWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'lane-scan-'));
  const main = join(root, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-q', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const linked = join(root, 'linked');
  git(main, 'worktree', 'add', '-q', '-b', 'topic', linked);
  return { main, linked };
}

/** A scanner whose slow measure is a counter, so a test can see when it ran. */
function countingScanner({ print, status }) {
  const counter = { full: 0 };
  const scan = createLaneScanner({ print, status, full: (path) => ({ path, n: ++counter.full }) });
  return { counter, scan };
}

test('TC-LIGHT-01: an unchanged checkout is measured once; later cycles reuse the row', () => {
  const { counter, scan } = countingScanner({ print: () => 'p1', status: () => [] });
  const first = scan('/x');
  const second = scan('/x');
  assert.equal(counter.full, 1);
  assert.equal(second, first);
});

test('TC-LIGHT-02: a changed fingerprint (new commit, moved ref) measures the checkout again', () => {
  let print = 'p1';
  const { counter, scan } = countingScanner({ print: () => print, status: () => [] });
  scan('/x');
  print = 'p2';
  scan('/x');
  assert.equal(counter.full, 2);
});

test('TC-LIGHT-03: a changed dirty list measures again even when the fingerprint is the same', () => {
  let dirty = [];
  const { counter, scan } = countingScanner({ print: () => 'p1', status: () => dirty });
  scan('/x');
  dirty = ['a.txt'];
  scan('/x');
  scan('/x');
  assert.equal(counter.full, 2);
});

test('TC-LIGHT-04: each checkout is cached on its own path', () => {
  const { counter, scan } = countingScanner({ print: () => 'p1', status: () => [] });
  scan('/x');
  scan('/y');
  scan('/x');
  assert.equal(counter.full, 2);
});

test('TC-LIGHT-05: the fingerprint changes after a commit and after the default branch ref moves, in a linked worktree too', () => {
  const { main, linked } = repoWithWorktree();
  const before = lanePrint(linked);
  assert.equal(lanePrint(linked), before);
  writeFileSync(join(linked, 'a.txt'), 'one\ntwo\n');
  git(linked, 'commit', '-q', '-am', 'topic work');
  const afterCommit = lanePrint(linked);
  assert.notEqual(afterCommit, before);
  git(main, 'update-ref', 'refs/remotes/origin/main', 'topic');
  assert.notEqual(lanePrint(linked), afterCommit);
});

test('TC-LIGHT-06: a folder that is not a repository gets a stable fingerprint instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-scan-none-'));
  assert.equal(lanePrint(dir), lanePrint(dir));
});
