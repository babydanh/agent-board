// Snapshots of a lane for the exact cross-machine overlap check (design decisions 2, 3 and 5).
// A lane (HEAD plus its uncommitted files) becomes a commit under refs/wip/<machine>/<lane> on the remote. It is built
// through a temporary index, like ~/.omp/scripts/overlap.py and backup-push.py, so the real index, the working tree and
// HEAD never change. Only that namespace is ever written; secrets are filtered first (snapshotFilter.mjs).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultBranch, git,GIT_OPTIONS } from './agent.mjs';
import { filterSnapshotFiles } from './snapshotFilter.mjs';

export const MIN_PUSH_GAP_MS = 60_000;
// Text beyond this is not read for the token check (the size filter still sees the file).
const MAX_TEXT_BYTES = 1024 * 1024;
const MACHINE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const WIP_REF = /^refs\/wip\/[a-z0-9][a-z0-9-]{0,39}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** `refs/wip/<machine>/<lane>`; the lane is a branch name made safe for a ref. */
export function wipRef(machine, lane) {
  if (!MACHINE.test(machine)) throw new Error('machine must match [a-z0-9-], at most 40 characters');
  const safe = String(lane).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').replace(/\.lock$/, '-lock');
  if (!safe) throw new Error('lane has no usable characters');
  return `refs/wip/${machine}/${safe.slice(0, 100)}`;
}

export function assertWipRef(ref) {
  if (!WIP_REF.test(ref) || ref.includes('..')) throw new Error(`only refs/wip/<machine>/<lane> may be written, not ${ref}`);
}

/** Force-pushes one commit to one wip ref (the machine owns its namespace, so a rewrite is expected). Never a branch. */
export function pushWipRef(path, commit, ref) {
  assertWipRef(ref);
  execFileSync('git', ['-C', path, 'push', '-q', '--no-verify', 'origin', `+${commit}:${ref}`], { ...GIT_OPTIONS, timeout: 60_000 });
}

/** Deletes one wip ref from the remote. Same guard as the push: nothing outside refs/wip/<machine>/<lane> is ever named. */
export function deleteWipRef(path, ref) {
  assertWipRef(ref);
  try {
    execFileSync('git', ['-C', path, 'push', '-q', '--no-verify', 'origin', `:${ref}`], { ...GIT_OPTIONS, timeout: 60_000 });
  } catch (error) {
    // Already gone from the remote (deleted by hand or by an earlier run): that is the state we wanted.
    const listed = execFileSync('git', ['-C', path, 'ls-remote', 'origin', ref], { ...GIT_OPTIONS, timeout: 60_000 });
    if (listed.trim() !== '') throw error;
  }
}

export const WIP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Deletes this machine's snapshot refs that were last pushed more than `maxAgeMs` ago (the state file records when).
 * Another machine's namespace and every branch are never touched. A delete that fails keeps its entry for the next run.
 * Returns the refs removed.
 */
export function pruneSnapshots(path, machine, { remove = deleteWipRef, now = Date.now, maxAgeMs = WIP_MAX_AGE_MS } = {}) {
  const file = stateFile(path);
  const state = readState(file);
  const prefix = `refs/wip/${machine}/`;
  const removed = [];
  for (const [ref, entry] of Object.entries(state)) {
    if (!ref.startsWith(prefix) || !(now() - Number(entry?.at) >= maxAgeMs)) continue;
    try { remove(path, ref); } catch { continue; }
    delete state[ref];
    removed.push(ref);
  }
  if (removed.length > 0) writeFileSync(file, JSON.stringify(state));
  return removed;
}

/** Raw git output, untrimmed, stdin optional; failures throw. */
function raw(path, args, { env, input } = {}) {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, input, env: env ? { ...process.env, ...env } : process.env,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  });
}

/** Paths from `git status --porcelain -z` (renames name both ends). `--no-optional-locks`: never touch the index. */
function dirtyList(path) {
  const parts = raw(path, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    paths.push(parts[i].slice(3));
    if (/[RC]/.test(code)) { i += 1; paths.push(parts[i]); }
  }
  return paths;
}

/** Added lines per file of the lane's commits since the default branch. */
function committedAdds(path, base) {
  const adds = new Map();
  let current = null;
  for (const line of raw(path, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', `${base}...HEAD`]).split('\n')) {
    if (line.startsWith('+++ b/')) { current = line.slice(6); adds.set(current, ''); continue; }
    if (current && line.startsWith('+') && !line.startsWith('+++')) adds.set(current, `${adds.get(current)}${line}\n`);
  }
  return adds;
}

function readDirty(path, relative) {
  try {
    const full = join(path, relative);
    const { size } = statSync(full);
    const text = size <= MAX_TEXT_BYTES ? readFileSync(full, 'utf8') : '';
    return { path: relative, size, addedText: text, hash: createHash('sha1').update(text).update(String(size)).digest('hex') };
  } catch {
    return { path: relative, size: 0, addedText: '', hash: 'gone' };
  }
}

function stateFile(path) {
  return join(raw(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'fleet-snapshot-state.json');
}

const readState = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };

/** A commit holding HEAD's tree plus the kept dirty files, made through a temporary copy of the index. */
function commitWithFiles(path, head, keep) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-snap-'));
  try {
    const realIndex = raw(path, ['rev-parse', '--path-format=absolute', '--git-path', 'index']).trim();
    const tmpIndex = join(dir, 'index');
    if (existsSync(realIndex)) copyFileSync(realIndex, tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex };
    raw(path, ['add', '-A', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: keep.join('\0') });
    const tree = raw(path, ['write-tree'], { env }).trim();
    return raw(path, ['-c', 'user.name=fleet', '-c', 'user.email=fleet@localhost', 'commit-tree', tree, '-p', head, '-m', 'fleet snapshot']).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Pushes the lane's snapshot. Returns { ref, commit, omitted } or null when there is nothing new to send (clean and
 * level with the default branch, unchanged since the last push, or pushed less than a minute ago). A secret-shaped
 * line in the lane's own commits returns { ref: null, commit: null, omitted }: nothing is pushed for that lane.
 * `push` and `now` exist so tests can observe the push and the clock.
 */
export function snapshotLane(path, machine, { push = pushWipRef, now = Date.now } = {}) {
  const head = git(path, 'rev-parse', 'HEAD');
  if (!head) return null;
  const branch = git(path, 'branch', '--show-current') || `detached-${head.slice(0, 8)}`;
  const ref = wipRef(machine, branch);
  const base = defaultBranch(path);
  const dirty = dirtyList(path);
  if (dirty.length === 0 && Number(git(path, 'rev-list', '--count', `${base}..HEAD`)) === 0) return null;

  const file = stateFile(path);
  const state = readState(file);
  const sent = state[ref];
  if (sent && now() - sent.at < MIN_PUSH_GAP_MS) return null;

  const dirtyFiles = dirty.map((relative) => readDirty(path, relative));
  const key = `${head}:${dirtyFiles.map((f) => `${f.path}=${f.hash}`).sort().join(',')}`;
  if (sent?.key === key) return null;

  const committed = [...committedAdds(path, base)].map(([relative, addedText]) => ({ path: relative, size: 0, addedText }));
  const blocked = filterSnapshotFiles(committed).omitted;
  if (blocked.length > 0) return { ref: null, commit: null, omitted: blocked };

  const { keep, omitted } = filterSnapshotFiles(dirtyFiles);
  const commit = keep.length === 0 ? head : commitWithFiles(path, head, keep);
  push(path, commit, ref);
  state[ref] = { key, at: now(), commit };
  writeFileSync(file, JSON.stringify(state));
  return { ref, commit, omitted };
}
