// The exact overlap verdict (design decision 5): git's own merge on two snapshot commits.
// Only pairs that touch a common file are measured. A pair that cannot be fully checked (out of time, a snapshot that is
// missing or taken mid-merge) is "incomplete": the board must never show it as clean.
import { spawnSync } from 'node:child_process';

import { defaultBranch } from './agent.mjs';

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status, out: result.stdout ?? '' };
}

/** Files a snapshot changed since its fork from the default branch, or null when git cannot say (missing commit). */
function touchedFiles(repo, base, commit) {
  const { code, out } = git(repo, ['diff', '--name-only', '--no-renames', `${base}...${commit}`]);
  return code === 0 ? new Set(out.split('\n').filter(Boolean)) : null;
}

/** Line ranges of the conflict-marker blocks in the merged file (lines of the merged result, approximate for the lanes). */
function conflictRanges(repo, tree, file) {
  const ranges = [];
  let start = 0;
  git(repo, ['cat-file', '-p', `${tree}:${file}`]).out.split('\n').forEach((line, index) => {
    if (line.startsWith('<<<<<<<')) start = index + 1;
    else if (line.startsWith('>>>>>>>') && start > 0) { ranges.push([start, index + 1]); start = 0; }
  });
  return ranges;
}

/**
 * @param {string} repo a repository that already holds every snapshot commit (fetched into refs/wip)
 * @param {{ name: string, commit: string, unstable?: boolean }[]} snapshots `unstable`: taken mid-merge or mid-rebase
 * @returns {{ a: string, b: string, file: string, status: 'conflict' | 'auto' | 'incomplete', ranges?: number[][] }[]}
 */
export function judgeRepo(repo, snapshots, { budgetMs, now = Date.now }) {
  const start = now();
  const base = defaultBranch(repo);
  const lanes = [...snapshots].sort((x, y) => x.name.localeCompare(y.name)).map((lane) => ({ ...lane, touched: touchedFiles(repo, base, lane.commit) }));
  const verdicts = [];
  for (let i = 0; i < lanes.length; i += 1) {
    for (let j = i + 1; j < lanes.length; j += 1) {
      const [a, b] = [lanes[i], lanes[j]];
      const shared = a.touched && b.touched ? [...a.touched].filter((file) => b.touched.has(file)) : null;
      if (shared?.length === 0) continue;
      const incomplete = () => verdicts.push({ a: a.name, b: b.name, file: '', status: 'incomplete' });
      if (shared === null || a.unstable || b.unstable || now() - start >= budgetMs) { incomplete(); continue; }
      const merge = git(repo, ['merge-tree', '--write-tree', '--name-only', a.commit, b.commit]);
      if (merge.code !== 0 && merge.code !== 1) { incomplete(); continue; }
      const [tree, ...rest] = merge.out.split('\n');
      const blank = rest.indexOf('');
      const conflicted = new Set(merge.code === 1 ? rest.slice(0, blank === -1 ? rest.length : blank).filter(Boolean) : []);
      for (const file of [...new Set([...shared, ...conflicted])].sort()) {
        verdicts.push(conflicted.has(file)
          ? { a: a.name, b: b.name, file, status: 'conflict', ranges: conflictRanges(repo, tree.trim(), file) }
          : { a: a.name, b: b.name, file, status: 'auto' });
      }
    }
  }
  return verdicts;
}
