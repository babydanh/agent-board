// The judge asks git itself: merge-tree on two snapshot commits. A pair that shares no file has nothing to say; a pair
// that is not fully checked is "incomplete", never "clean".
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { judgeRepo } from './judge.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const lines = (...parts) => `${parts.join('\n')}\n`;

/** A repository with `origin/main` holding a 10-line file, plus a helper that makes a lane commit from it. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'shared.txt'), lines(...Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)));
  writeFileSync(join(dir, 'other.txt'), lines('x'));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const lane = (name, edits) => {
    git(dir, 'checkout', '-q', '-b', name, 'main');
    for (const [file, text] of Object.entries(edits)) writeFileSync(join(dir, file), text);
    git(dir, 'commit', '-q', '-am', name);
    const commit = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', 'main');
    return { name, commit };
  };
  return { dir, lane };
}

const body = (changes) => lines(...Array.from({ length: 10 }, (_, i) => changes[i + 1] ?? `line ${i + 1}`));

test('TC-JUDGE-01: two lanes editing the same line conflict, naming the file and the line range', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 5: 'from a' }) });
  const b = lane('b', { 'shared.txt': body({ 5: 'from b' }) });
  const verdicts = judgeRepo(dir, [a, b], { budgetMs: 60_000 });
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].status, 'conflict');
  assert.equal(verdicts[0].file, 'shared.txt');
  assert.equal(verdicts[0].a, 'a');
  assert.equal(verdicts[0].b, 'b');
  assert.ok(verdicts[0].ranges.length > 0);
  assert.ok(verdicts[0].ranges.every(([start, end]) => start >= 1 && end >= start));
});

test('TC-JUDGE-02: the same file in different regions merges by itself', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 2: 'from a' }) });
  const b = lane('b', { 'shared.txt': body({ 9: 'from b' }) });
  assert.deepEqual(judgeRepo(dir, [a, b], { budgetMs: 60_000 }).map((v) => [v.file, v.status]), [['shared.txt', 'auto']]);
});

test('TC-JUDGE-03: out of time, a pair is incomplete and never clean', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 5: 'from a' }) });
  const b = lane('b', { 'shared.txt': body({ 5: 'from b' }) });
  const verdicts = judgeRepo(dir, [a, b], { budgetMs: 0 });
  assert.deepEqual(verdicts.map((v) => v.status), ['incomplete']);
});

test('TC-JUDGE-04: a lane caught mid-merge is incomplete, whatever git says about it', () => {
  const { dir, lane } = fixture();
  const a = { ...lane('a', { 'shared.txt': body({ 2: 'from a' }) }), unstable: true };
  const b = lane('b', { 'shared.txt': body({ 9: 'from b' }) });
  assert.deepEqual(judgeRepo(dir, [a, b], { budgetMs: 60_000 }).map((v) => v.status), ['incomplete']);
});

test('TC-JUDGE-05: lanes that share no file produce no verdict', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 2: 'from a' }) });
  const b = lane('b', { 'other.txt': lines('y') });
  assert.deepEqual(judgeRepo(dir, [a, b], { budgetMs: 60_000 }), []);
});

test('TC-JUDGE-06: a conflict in one file and an auto merge in another are reported per file', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 5: 'from a' }), 'other.txt': lines('x', 'a adds') });
  const b = lane('b', { 'shared.txt': body({ 5: 'from b' }), 'other.txt': lines('b first', 'x') });
  const byFile = Object.fromEntries(judgeRepo(dir, [a, b], { budgetMs: 60_000 }).map((v) => [v.file, v.status]));
  assert.deepEqual(byFile, { 'shared.txt': 'conflict', 'other.txt': 'auto' });
});

test('TC-JUDGE-07: a snapshot commit the scratch repository does not have is incomplete, not an error', () => {
  const { dir, lane } = fixture();
  const a = lane('a', { 'shared.txt': body({ 2: 'from a' }) });
  const missing = { name: 'ghost', commit: '1'.repeat(40) };
  assert.deepEqual(judgeRepo(dir, [a, missing], { budgetMs: 60_000 }).map((v) => v.status), ['incomplete']);
});
