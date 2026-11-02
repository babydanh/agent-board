// The judge machine's side of the exact overlap check: fetch every machine's refs/wip into a clone it already holds,
// judge the repositories the hub assigned (fleet/hub.mjs `judge`), and remember the assignment between runs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { GIT_OPTIONS } from './agent.mjs';
import { judgeRepo } from './judge.mjs';

const FETCH_TIMEOUT_MS = 60_000;
const WIP_PREFIX = 'refs/wip/';

/** `[{ name: 'machine/lane', commit }]` for every wip ref now in `path`. */
function wipSnapshots(path) {
  const out = execFileSync('git', ['-C', path, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/wip'], GIT_OPTIONS);
  return out.split('\n').filter(Boolean).map((line) => {
    const [ref, commit] = line.split(' ');
    return { name: ref.slice(WIP_PREFIX.length), commit };
  });
}

/**
 * Verdicts for the assigned repositories, each carrying its repository identity. A repository with no clone here, a
 * failed fetch or fewer than two snapshots is skipped: the board then shows nothing for it ("chưa tính"), never "clean".
 */
export function collectVerdicts(assigned, rows, { budgetMs }) {
  const verdicts = [];
  for (const repo of assigned) {
    const path = rows.find((row) => row.github_repo === repo && existsSync(row.path))?.path;
    if (!path) continue;
    try {
      execFileSync('git', ['-C', path, 'fetch', '-q', '--no-tags', 'origin', '+refs/wip/*:refs/wip/*'], { ...GIT_OPTIONS, timeout: FETCH_TIMEOUT_MS });
      const snapshots = wipSnapshots(path);
      if (snapshots.length < 2) continue;
      for (const verdict of judgeRepo(path, snapshots, { budgetMs })) verdicts.push({ repo, ...verdict });
    } catch (error) {
      console.error(`fleet-agent: judge ${repo}: ${error.message}`);
    }
  }
  return verdicts;
}

export function loadJudgeList(file) {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveJudgeList(file, list) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []));
}
