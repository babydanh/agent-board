// Runs the hub's remote commands on this machine (design decisions 8-9). Fixed verbs only, git through argv (no shell),
// and the same checks the hub made are made again here: a command that reaches this file is never trusted.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { commandError, isProtectedBranch } from './commandSpec.mjs';

const GIT_TIMEOUT_MS = 60_000;
const MAX_DETAIL = 500;
let busy = false;

/** Raw git, argv only. Failures throw; nothing is interpreted by a shell. */
export const execGit = (args) =>
  execFileSync('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const same = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const result = (id, status, detail) => ({ id, status, detail: String(detail).slice(0, MAX_DETAIL) });
const refuse = (id, detail) => result(id, 'refused', detail);

async function snapshotPush(cmd, deps) {
  const done = await deps.snapshot(cmd.args.path, deps.machine);
  if (done === null || done === undefined) return result(cmd.id, 'success', 'nothing new to push');
  if (done.ref === null) return result(cmd.id, 'failed', `nothing pushed: ${done.omitted?.length ?? 0} file(s) held back by the secret filter`);
  return result(cmd.id, 'success', `pushed ${done.ref}`);
}

/** Removes one clean linked worktree. Refuses the main checkout, a protected branch, a dirty tree and commits no remote has; never forces. */
function cleanWorktree(cmd, deps) {
  const { path } = cmd.args;
  const lines = deps.exec(['-C', path, 'rev-parse', '--git-dir', '--git-common-dir']).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return result(cmd.id, 'failed', 'could not read the git directories');
  const gitDir = resolve(path, lines[0]);
  const commonDir = resolve(path, lines[1]);
  if (same(gitDir, commonDir)) return refuse(cmd.id, 'this is the main checkout, not a linked worktree');
  const branch = deps.exec(['-C', path, 'branch', '--show-current']).trim();
  if (branch && isProtectedBranch(branch)) return refuse(cmd.id, `branch ${branch} is protected`);
  const dirty = deps.exec(['-C', path, 'status', '--porcelain']).split(/\r?\n/).filter(Boolean);
  if (dirty.length > 0) return refuse(cmd.id, `${dirty.length} uncommitted path(s)`);
  const onRemote = deps.exec(['-C', path, 'for-each-ref', '--contains', 'HEAD', '--count=1', '--format=%(refname)', 'refs/remotes']).trim();
  if (!onRemote) return refuse(cmd.id, 'HEAD is not on any remote branch');
  // Run from the common git directory: a worktree cannot remove the directory a command is running in.
  deps.exec(['--git-dir', commonDir, 'worktree', 'remove', path]);
  return result(cmd.id, 'success', `removed ${path}`);
}

const BUILT_IN = { 'snapshot-push': snapshotPush, 'clean-worktree': cleanWorktree };

/**
 * Runs one command and returns `{ id, status: success|failed|refused, detail }`; never throws.
 * deps: machine, now(), lanes() (checkout paths this machine owns), snapshot(path, machine), exec(argv) (git),
 * executors (verb -> (args) => detail, for verbs this machine can run: run-tests, staging-sync).
 */
export async function runCommand(cmd, deps) {
  const id = String(cmd?.id ?? '');
  try {
    if (!(cmd.expires_at > deps.now())) return refuse(id, 'command expired');
    const reason = commandError(cmd.verb, cmd.args);
    if (reason) return refuse(id, reason);
    const own = typeof cmd.args.path === 'string' ? cmd.args.path : null;
    if (own !== null && !deps.lanes().some((lane) => same(lane, own))) return refuse(id, 'not a checkout of this machine');
    const run = BUILT_IN[cmd.verb] ?? (deps.executors?.[cmd.verb] ? async (c) => result(c.id, 'success', await deps.executors[cmd.verb](c.args)) : null);
    if (!run) return refuse(id, `${cmd.verb} is not available on this machine`);
    if (busy) return refuse(id, 'another command is running');
    busy = true;
    try { return await run(cmd, { exec: execGit, ...deps }); } finally { busy = false; }
  } catch (error) {
    return result(id, 'failed', error?.message ?? error);
  }
}

/** Results wait in a file until the hub confirms a report, so a lost response never loses a result. */
export function loadPendingResults(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function savePendingResults(file, results) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(results), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

const MAX_PER_REPORT = 5;

/**
 * Runs what a report reply delivered, one at a time, and leaves ONLY the new results in `file` (the previous ones were
 * just confirmed by that same reply). A machine that has not opted in answers `refused`, so the board sees why nothing ran.
 */
export async function runDelivered(commands, { enabled, file, deps }) {
  const results = [];
  for (const cmd of Array.isArray(commands) ? commands.slice(0, MAX_PER_REPORT) : []) {
    results.push(enabled ? await runCommand(cmd, deps) : refuse(String(cmd?.id ?? ''), 'commands are off on this machine'));
  }
  savePendingResults(file, results);
  return results;
}
