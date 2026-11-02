// The fixed list of remote commands and how their arguments are checked (design decisions 8-9).
// The hub checks a command when it is queued and the machine checks it again before running it: both import this file.

export const VERBS = ['snapshot-push', 'clean-worktree', 'run-tests', 'staging-sync'];

const PROTECTED_BRANCHES = new Set(['main', 'master', 'prod', 'production', 'staging']);
const REF_PREFIXES = ['refs/heads/', 'refs/remotes/origin/', 'refs/remotes/', 'origin/'];
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;
const MAX_PATH = 500;

/** True when `name` is, once any ref prefix is removed, a branch no remote command may touch. */
export function isProtectedBranch(name) {
  let bare = String(name).trim().toLowerCase();
  for (const prefix of REF_PREFIXES) if (bare.startsWith(prefix)) { bare = bare.slice(prefix.length); break; }
  return PROTECTED_BRANCHES.has(bare);
}

function pathError(value) {
  if (typeof value !== 'string' || value === '' || value.length > MAX_PATH) return 'path must be a non-empty string';
  if (value.startsWith('-') || value.includes('\0') || value.includes('\n')) return 'path is not allowed';
  return null;
}

function branchError(value) {
  if (typeof value !== 'string' || !BRANCH_PATTERN.test(value)) return 'branch has characters that are not allowed';
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.includes('..') || value.includes('//')) return 'branch is not allowed';
  if (isProtectedBranch(value)) return 'branch is protected';
  return null;
}

const CHECKS = {
  'snapshot-push': (args) => pathError(args.path),
  'clean-worktree': (args) => pathError(args.path) ?? (args.branch === undefined ? null : branchError(args.branch)),
  'run-tests': (args) => branchError(args.branch),
  'staging-sync': (args) => branchError(args.branch),
};

/** Why `{ verb, args }` must not run, or null when it is allowed. Never throws. */
export function commandError(verb, args) {
  if (!VERBS.includes(verb)) return 'unknown verb';
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'args must be an object';
  return CHECKS[verb](args);
}
