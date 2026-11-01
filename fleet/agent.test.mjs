import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  changedRanges,
  defaultBranch,
  fitReport,
  parseLavish,
  parseTmux,
  readSkillVersion,
  readTaskBook,
  shouldBackupGuard,
  shouldPruneGuard,
  summarizeGuard,
} from './agent.mjs';

test('a huge diff is cut to fit the hub limit, keeping the file list', () => {
  const changes = Array.from({ length: 200 }, (_, i) => ({ path: `src/very/long/path/to/file-${i}.ts`, ranges: Array.from({ length: 20 }, (_, j) => [j * 10 + 1, j * 10 + 5]) }));
  const repos = Array.from({ length: 5 }, (_, r) => ({ path: `/data/home/r${r}`, branch: 'b', dirty_files: ['a.ts', 'b.ts'], changes: structuredClone(changes) }));
  const report = fitReport({ agent_id: 'danh', sessions: [], repos });
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 60_000);
  assert.ok(report.repos.some((r) => r.changes_truncated));
  assert.deepEqual(report.repos[0].dirty_files, ['a.ts', 'b.ts']);
});

test('a small report is left untouched', () => {
  const report = { agent_id: 'danh', sessions: [], repos: [{ path: '/x', branch: 'b', dirty_files: ['a.ts'], changes: [{ path: 'a.ts', ranges: [[1, 2]] }] }] };
  assert.deepEqual(fitReport(structuredClone(report)), report);
});

test('a compact guard summary keeps risks and bounded worktree metadata', () => {
  const guard = {
    machine: 'm1',
    scannedAt: '2026-10-29T00:00:00.000Z',
    repos: [
      {
        repo: '/repo',
        stashes: 2,
        worktrees: [
          {
            path: '/repo/wt',
            branch: 'feat/a',
            head: 'abc',
            unpushed: 1,
            unpushedSubjects: ['work'],
            backedUp: false,
            dirty: 0,
            dirtyKnown: true,
            dirtyOldestMinutes: null,
            op: null,
            mergedToMain: false,
            idleDays: 3,
            prunable: false,
            idleMinutes: 4321,
            ignored: 2,
          },
        ],
      },
    ],
    risks: [
      { level: 'red', kind: 'unpushed', repo: '/repo', path: '/repo/wt', detail: 'not backed up' },
    ],
  };
  const summary = summarizeGuard(guard);
  assert.equal(summary.machine, 'm1');
  assert.equal(summary.repos[0].worktrees[0].head, 'abc');
  assert.equal(summary.repos[0].worktrees[0].unpushedSubjects[0], 'work');
  assert.equal(summary.repos[0].worktrees[0].idleMinutes, 4321);
  assert.equal(summary.repos[0].worktrees[0].ignored, 2);
  assert.equal(summary.repos[0].worktrees[0].dirtyKnown, true);
  assert.equal(summary.risks[0].kind, 'unpushed');
  assert.equal('stashes' in summary.repos[0], false);
});

test('guard reports are size-bounded and backup interval is thirty minutes', () => {
  const worktree = {
    path: '/repo/wt', branch: 'feat/a', head: 'a'.repeat(40), unpushed: 1,
    unpushedSubjects: ['work'], backedUp: false, dirty: 0, dirtyOldestMinutes: null,
    op: null, mergedToMain: false, idleDays: 3, prunable: false,
  };
  const large = {
    machine: 'm1', scannedAt: '2026-10-29T00:00:00.000Z',
    repos: Array.from({ length: 30 }, (_, i) => ({ repo: `/repo/${i}`, worktrees: Array.from({ length: 100 }, () => worktree) })),
    risks: Array.from({ length: 100 }, () => ({ level: 'red', kind: 'unpushed', repo: '/repo', path: '/repo/wt', detail: 'x'.repeat(300) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(summarizeGuard(large))) <= 14_000);
  assert.equal(shouldBackupGuard(1_000, 1_000 + 30 * 60 * 1000 - 1), false);
  assert.equal(shouldBackupGuard(1_000, 1_000 + 30 * 60 * 1000), true);
  assert.equal(shouldBackupGuard(Number.NaN, 1_000), true);
});

test('many repos with long dirty paths still end under the limit', () => {
  const long = 'x'.repeat(200);
  const repos = Array.from({ length: 20 }, (_, r) => ({ path: `/data/home/${long}-${r}`, branch: long, dirty_files: Array.from({ length: 200 }, (_, i) => `${long}/${i}.ts`), changes: [] }));
  const report = fitReport({ agent_id: 'danh', sessions: [], repos });
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 60_000);
});

test('tmux lines include detected engine, attached state, idle time and branch', () => {
  const text = 'xep-san\t1\t900\t/data/home/wt/backend-xep-san\tclaude\nnhap\t0\t1000\t\tbash\ncodex\t0\t950\t/data/home/wt/codex\tcodex\n';
  assert.deepEqual(
    parseTmux(text, 1000, (cwd) => (cwd.includes('xep-san') ? 'cloud/danh-xep-san' : '')),
    [
      {
        name: 'xep-san',
        cwd: '/data/home/wt/backend-xep-san',
        attached: true,
        idle_seconds: 100,
        engine: 'claude',
        command: 'claude',
        branch: 'cloud/danh-xep-san',
      },
      { name: 'nhap', cwd: '', attached: false, idle_seconds: 0, command: 'bash', branch: '' },
      {
        name: 'codex',
        cwd: '/data/home/wt/codex',
        attached: false,
        idle_seconds: 50,
        engine: 'codex',
        command: 'codex',
        branch: '',
      },
    ],
  );
  assert.deepEqual(parseTmux('', 1000), []);
});

test('lavish state keeps open sessions with hex keys, drops ended ones and junk', () => {
  const state = JSON.stringify({ sessions: {
    a: { key: 'b702b4f8df032645', file: '/data/home/wt/x/.lavish/plan.html', status: 'open', prompts: [] },
    b: { key: 'c0ffee00c0ffee00', file: '/tmp/old.html', status: 'ended' },
    c: { key: '../x', file: '/tmp/y.html', status: 'open' },
  } });
  assert.deepEqual(parseLavish(state), [{ key: 'b702b4f8df032645', file: '/data/home/wt/x/.lavish/plan.html' }]);
  assert.deepEqual(parseLavish('not json'), []);
});

test('task book: valid entries only, missing folder means no tasks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'viec-'));
  writeFileSync(join(dir, 'xep-san.json'), JSON.stringify({ slug: 'xep-san', status: 'dang-lam', branch: 'cloud/danh-xep-san', kind: 'all', session: 'secret-ish' }));
  writeFileSync(join(dir, 'bad.json'), '{not json');
  writeFileSync(join(dir, 'evil.json'), JSON.stringify({ slug: '../x', status: 'dang-lam' }));
  assert.deepEqual(readTaskBook(dir), [{ slug: 'xep-san', status: 'dang-lam', branch: 'cloud/danh-xep-san', kind: 'all' }]);
  assert.deepEqual(readTaskBook(join(dir, 'khong-co')), []);
});

test('cloud guard pruning is enabled by default every six hours', () => {
  assert.equal(shouldPruneGuard(1_000, 1_000 + 6 * 60 * 60 * 1000 - 1), false);
  assert.equal(shouldPruneGuard(1_000, 1_000 + 6 * 60 * 60 * 1000), true);
  assert.equal(shouldPruneGuard(Number.NaN, 1_000), true);
  assert.equal(shouldPruneGuard(Number.NaN, 1_000, false), false);
});


test('readSkillVersion returns the 12-char sync hash, or null when the file is missing or malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillver-'));
  const good = join(dir, 'good');
  const bad = join(dir, 'bad');
  writeFileSync(good, '9e7a47bf9348\n');
  writeFileSync(bad, 'not a hash');
  assert.equal(readSkillVersion(good), '9e7a47bf9348');
  assert.equal(readSkillVersion(bad), null);
  assert.equal(readSkillVersion(join(dir, 'missing')), null);
});

const gitIn = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** A local "remote" whose default branch is master, plus an unrelated `main`, cloned and left on master. */
function cloneWithUnrelatedMain() {
  const base = mkdtempSync(join(tmpdir(), 'base-default-'));
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  gitIn(base, 'init', '-q', '--bare', '-b', 'master', origin);
  gitIn(base, 'init', '-q', '-b', 'master', seed);
  writeFileSync(join(seed, 'a.txt'), 'one\ntwo\n');
  gitIn(seed, 'add', 'a.txt');
  gitIn(seed, 'commit', '-q', '-m', 'master');
  gitIn(seed, 'push', '-q', origin, 'master');
  gitIn(seed, 'checkout', '-q', '--orphan', 'main');
  gitIn(seed, 'rm', '-q', '-rf', '.');
  writeFileSync(join(seed, 'other.txt'), 'unrelated\n');
  gitIn(seed, 'add', 'other.txt');
  gitIn(seed, 'commit', '-q', '-m', 'unrelated main');
  gitIn(seed, 'push', '-q', origin, 'main');
  gitIn(base, 'clone', '-q', origin, clone);
  return clone;
}

test('TC-BASE-DEFAULT-01: a branch level with the real default branch reports no changes even when origin/main is unrelated', () => {
  const clone = cloneWithUnrelatedMain();
  gitIn(clone, 'checkout', '-q', '-b', 'stable', 'origin/master');
  assert.equal(defaultBranch(clone), 'origin/master');
  assert.deepEqual(changedRanges(clone), []);
});

test('TC-BASE-DEFAULT-02: a pushed but unmerged branch still lists its changed files', () => {
  const clone = cloneWithUnrelatedMain();
  gitIn(clone, 'checkout', '-q', '-b', 'feat', 'origin/master');
  writeFileSync(join(clone, 'a.txt'), 'one\nTWO\n');
  gitIn(clone, 'commit', '-q', '-am', 'change');
  gitIn(clone, 'push', '-q', '-u', 'origin', 'feat');
  assert.equal(gitIn(clone, 'rev-list', '--count', '@{upstream}..HEAD').trim(), '0');
  assert.deepEqual(changedRanges(clone), [{ path: 'a.txt', ranges: [[2, 2]] }]);
});

/** A release branch like Flutter's `stable`: pushed with its own commits that are not in master, checked out level with its upstream. */
function cloneOnReleaseBranch() {
  const clone = cloneWithUnrelatedMain();
  gitIn(clone, 'checkout', '-q', '-b', 'stable', 'origin/master');
  writeFileSync(join(clone, 'a.txt'), 'one\ncherry-picked\n');
  gitIn(clone, 'commit', '-q', '-am', 'cherry-pick only on stable');
  gitIn(clone, 'push', '-q', '-u', 'origin', 'stable');
  return clone;
}

test('TC-BASE-LONGLIVED-01: a long-lived branch level with its upstream reports no changes', () => {
  const clone = cloneOnReleaseBranch();
  assert.equal(gitIn(clone, 'rev-list', '--count', 'origin/master..HEAD').trim(), '1');
  assert.deepEqual(changedRanges(clone), []);
});

test('TC-BASE-LONGLIVED-02: on a long-lived branch only uncommitted and unpushed edits count', () => {
  const clone = cloneOnReleaseBranch();
  writeFileSync(join(clone, 'b.txt'), 'new\n');
  gitIn(clone, 'add', 'b.txt');
  gitIn(clone, 'commit', '-q', '-m', 'unpushed');
  writeFileSync(join(clone, 'a.txt'), 'one\ncherry-picked\nlocal edit\n');
  const paths = changedRanges(clone).map((change) => change.path).sort();
  assert.deepEqual(paths, ['a.txt', 'b.txt']);
});

test('TC-BASE-LONGLIVED-03: a long-lived branch that is behind its upstream reports no changes', () => {
  const clone = cloneOnReleaseBranch();
  const other = join(mkdtempSync(join(tmpdir(), 'base-behind-')), 'other');
  gitIn(clone, 'clone', '-q', gitIn(clone, 'remote', 'get-url', 'origin').trim(), other);
  gitIn(other, 'checkout', '-q', 'stable');
  writeFileSync(join(other, 'c.txt'), 'newer upstream work\n');
  gitIn(other, 'add', 'c.txt');
  gitIn(other, 'commit', '-q', '-m', 'upstream moves on');
  gitIn(other, 'push', '-q', 'origin', 'stable');
  gitIn(clone, 'fetch', '-q');
  assert.equal(gitIn(clone, 'rev-list', '--count', 'HEAD..@{upstream}').trim(), '1');
  assert.deepEqual(changedRanges(clone), []);
});

test('TC-BASE-DEFAULT-03: without a usable origin/HEAD the default branch is origin/main', () => {
  const dir = mkdtempSync(join(tmpdir(), 'base-nohead-'));
  gitIn(dir, 'init', '-q', '-b', 'main');
  assert.equal(defaultBranch(dir), 'origin/main');
  // origin/HEAD pointing at a ref that does not exist is as good as absent.
  gitIn(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone');
  assert.equal(defaultBranch(dir), 'origin/main');
});
