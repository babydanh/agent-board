// The hub names files another machine edits too; this writes them where the in-session [overlap] warning reads them.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git } from './agent.mjs';

const FILE = 'fleet-overlap.json';

/** Lanes in the shape of `overlap-lanes.json`: one per other machine, with `fleet:` instead of a worktree path. */
export function overlapLanes(overlaps, githubRepo) {
  const byMachine = new Map();
  for (const overlap of overlaps) {
    if (overlap.repo !== githubRepo) continue;
    for (const machine of overlap.machines) byMachine.set(machine, [...(byMachine.get(machine) ?? []), overlap.file]);
  }
  return [...byMachine].sort(([a], [b]) => a.localeCompare(b)).map(([machine, files]) => ({ path: `fleet:${machine}`, branch: null, mb: '', files, new: [] }));
}

/**
 * Writes `<git-common-dir>/fleet-overlap.json` for every reported repository, an empty one when nobody overlaps (so an
 * old warning goes away). Rows without a GitHub repository or outside a git repository are skipped.
 */
export function writeOverlapFiles(rows, overlaps) {
  const done = new Set();
  for (const row of rows) {
    if (typeof row.github_repo !== 'string' || row.github_repo === '') continue;
    const common = git(row.path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    if (common === '' || done.has(common)) continue;
    done.add(common);
    try {
      mkdirSync(common, { recursive: true });
      const target = join(common, FILE);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ lanes: overlapLanes(overlaps, row.github_repo) }));
      renameSync(temp, target);
    } catch (error) {
      console.error(`fleet-agent: overlap file ${common}: ${error.message}`);
    }
  }
}
