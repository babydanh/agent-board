// The judge machine's job: fetch every machine's refs/wip, judge the repositories the hub assigned, and keep the
// assignment between runs (the cloud agent is a one-shot timer, so a run's answer is used by the next run).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { collectVerdicts, loadJudgeList, saveJudgeList } from './judgeRun.mjs';
import { snapshotLane } from './snapshot.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const body = (changes) => `${Array.from({ length: 10 }, (_, i) => changes[i + 1] ?? `line ${i + 1}`).join('\n')}\n`;

/** An origin plus three clones: two machines that each edit line 5 of shared.txt, and the judge's own clone. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'judge-run-'));
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'init', '-q', '-b', 'main', seed);
  writeFileSync(join(seed, 'shared.txt'), body({}));
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', origin, 'main');
  const clone = (name) => { git(base, 'clone', '-q', origin, join(base, name)); return join(base, name); };
  const lane = (name, text) => {
    const dir = clone(name);
    git(dir, 'checkout', '-q', '-b', 'topic');
    writeFileSync(join(dir, 'shared.txt'), text);
    git(dir, 'commit', '-q', '-am', 'work');
    return dir;
  };
  return { origin, clone, lane };
}

test('TC-JUDGERUN-01: assigned repositories are fetched and judged, each verdict naming its repository', () => {
  const { lane, clone } = fixture();
  assert.ok(snapshotLane(lane('danh', body({ 5: 'from danh' })), 'danh', { now: () => 1_000_000 }));
  assert.ok(snapshotLane(lane('danh1', body({ 5: 'from danh1' })), 'danh1', { now: () => 1_000_000 }));
  const judgeClone = clone('judge');
  const verdicts = collectVerdicts(['o/r'], [{ path: judgeClone, github_repo: 'o/r' }], { budgetMs: 60_000 });
  assert.equal(verdicts.length, 1);
  assert.deepEqual({ repo: verdicts[0].repo, a: verdicts[0].a, b: verdicts[0].b, file: verdicts[0].file, status: verdicts[0].status },
    { repo: 'o/r', a: 'danh/topic', b: 'danh1/topic', file: 'shared.txt', status: 'conflict' });
});

test('TC-JUDGERUN-02: a repository with no local clone, or no assignment, yields nothing and never throws', () => {
  const { clone } = fixture();
  const judgeClone = clone('judge');
  assert.deepEqual(collectVerdicts(['o/missing'], [{ path: judgeClone, github_repo: 'o/r' }], { budgetMs: 60_000 }), []);
  assert.deepEqual(collectVerdicts([], [{ path: judgeClone, github_repo: 'o/r' }], { budgetMs: 60_000 }), []);
  assert.deepEqual(collectVerdicts(['o/r'], [{ path: join(tmpdir(), 'no-such-folder-xyz'), github_repo: 'o/r' }], { budgetMs: 60_000 }), []);
});

test('TC-JUDGERUN-03: a repository nobody has snapshotted yet yields nothing', () => {
  const { clone } = fixture();
  assert.deepEqual(collectVerdicts(['o/r'], [{ path: clone('judge'), github_repo: 'o/r' }], { budgetMs: 60_000 }), []);
});

test('TC-JUDGERUN-04: the assignment is kept between runs, and a missing or damaged file means none', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'judge-list-')), 'judge.json');
  assert.deepEqual(loadJudgeList(file), []);
  saveJudgeList(file, ['o/r', 'o/s']);
  assert.deepEqual(loadJudgeList(file), ['o/r', 'o/s']);
  writeFileSync(file, '{not json');
  assert.deepEqual(loadJudgeList(file), []);
  saveJudgeList(file, 'nonsense');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
});
