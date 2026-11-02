// Keeps the local reporter cheap: a checkout that did not move is not measured again.
// The fingerprint reads file times only (no git); `git status` stays the one per-cycle check for edits that touch
// neither HEAD nor the index.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { dirtyPaths } from './agent.mjs';

const mtime = (file) => {
  try { return statSync(file, { bigint: true }).mtimeNs; } catch { return 0n; }
};

/** The git dir of a checkout (".git" is a folder in a main checkout and a "gitdir: <path>" file in a linked one). */
function gitDirOf(path) {
  const dotGit = join(path, '.git');
  try {
    const text = readFileSync(dotGit, 'utf8');
    const target = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim();
    return target ? resolve(path, target) : dotGit;
  } catch {
    return dotGit;
  }
}

/** Where the shared refs live: a linked worktree's git dir names it in `commondir`, a main checkout is its own. */
function commonDirOf(gitDir) {
  try {
    const rel = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
    return isAbsolute(rel) ? rel : resolve(gitDir, rel);
  } catch {
    return gitDir;
  }
}

/**
 * Changes when the checkout's HEAD or index moves, or when a remote ref moves (a fetch rewrites a loose ref through a
 * lock file, which updates its folder's time, or rewrites packed-refs).
 */
export function lanePrint(path) {
  const gitDir = gitDirOf(path);
  const common = commonDirOf(gitDir);
  return [join(gitDir, 'HEAD'), join(gitDir, 'index'), join(common, 'packed-refs'), join(common, 'refs', 'remotes', 'origin')]
    .map(mtime)
    .join('|');
}

/** Returns `scan(path)`: the cached row while fingerprint and dirty list are unchanged, else a fresh `full(path)`. */
export function createLaneScanner({ full, print = lanePrint, status = dirtyPaths }) {
  const cache = new Map();
  return (path) => {
    const dirty = status(path).join('\0');
    const fingerprint = print(path);
    const hit = cache.get(path);
    if (hit && hit.fingerprint === fingerprint && hit.dirty === dirty) return hit.row;
    const row = full(path);
    cache.set(path, { fingerprint, dirty, row });
    return row;
  };
}
