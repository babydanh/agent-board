// fleet-agent: one report (sessions, branches, dirty file paths) signed with this machine's Ed25519 key.
// Run by a systemd timer. Env: FLEET_HUB (https URL), FLEET_ID, FLEET_KEY (private key PEM path),
// FLEET_ROOT (default /data/home). Sends paths and branch names only; never file content.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { backup, prune, scan } from './git-guard.mjs';
import { signJwt } from './jwt.mjs';
import { collectVerdicts, loadJudgeList, saveJudgeList } from './judgeRun.mjs';
import { snapshotLane } from './snapshot.mjs';

const ROOT = process.env.FLEET_ROOT ?? '/data/home';

const GUARD_BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const GUARD_BACKUP_STAMP = join(homedir(), '.cache', 'git-guard', 'last-backup');
const GUARD_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GUARD_PRUNE_STAMP = join(homedir(), '.cache', 'git-guard', 'last-prune');
const ENGINES = { claude: /(^|\/)claude$/, codex: /(^|\/)codex$/, omp: /(^|\/)omp$/ };

// stderr is ignored: a missing upstream or ref is an expected answer here, and `--loop` would flood the log with it.
// windowsHide: without it every git call from a windowless node process opens a console window on Windows.
export const GIT_OPTIONS = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };

export const git = (cwd, ...args) => {
  try { return execFileSync('git', ['-C', cwd, ...args], GIT_OPTIONS).trim(); } catch { return ''; }
};

/**
 * Paths with uncommitted changes. `git()` trims the whole output, which would eat the leading space of the first
 * ` M path` line and cut its first character, so the status is read untrimmed.
 */
export function dirtyPaths(cwd) {
  let out = '';
  try { out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], GIT_OPTIONS); } catch { /* not a repository */ }
  return out.split('\n').filter(Boolean).map((line) => line.slice(3)).slice(0, 200);
}

function sessions() {
  const out = [];
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    let argv;
    try { argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { continue; }
    const exe = argv.find((a) => !a.startsWith('-') && !/node$|bun$/.test(a)) ?? '';
    const engine = Object.keys(ENGINES).find((k) => ENGINES[k].test(exe));
    if (!engine) continue;
    let cwd = '';
    try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* exited */ }
    out.push({ engine, pid: Number(pid), cwd, branch: cwd ? git(cwd, 'branch', '--show-current') : '' });
  }
  return out;
}

/**
 * tmux sessions on this machine: name, attached, idle time, active pane command, branch, and working directory.
 * Metadata only: screen content never leaves the machine (the board attaches over SSH on demand).
 */
export function parseTmux(text, nowSec, branchOf = () => '') {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached, activity, cwd, command] = line.split('\t');
      const engine = Object.keys(ENGINES).find((kind) => ENGINES[kind].test(command ?? ''));
      return {
        name,
        cwd: cwd ?? '',
        attached: Number(attached) > 0,
        idle_seconds: Math.max(0, nowSec - Number(activity || nowSec)),
        ...(engine === undefined ? {} : { engine }),
        command: command ?? '',
        branch: cwd ? branchOf(cwd) : '',
      };
    })
    .filter((s) => s.name)
    .slice(0, 30);
}

function tmuxSessions() {
  let text = '';
  try {
    text = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}\t#{session_attached}\t#{session_activity}\t#{pane_current_path}\t#{pane_current_command}'],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return []; }   // no tmux server = no sessions
  // An all-repo task runs in wt/<task>/ (not a repo itself): take the branch of its first child worktree.
  const branchOf = (cwd) => {
    const own = git(cwd, 'branch', '--show-current');
    if (own || !cwd.startsWith(join(ROOT, 'wt'))) return own;
    try {
      const child = readdirSync(cwd).find((name) => existsSync(join(cwd, name, '.git')));
      return child ? git(join(cwd, child), 'branch', '--show-current') : '';
    } catch { return ''; }
  };
  return parseTmux(text, Math.floor(Date.now() / 1000), branchOf);
}

/** Task book written by cloud-giao (~/.cloud-viec/*.json): name, status, branch. The Botkeep watch bot reads it. */
export function readTaskBook(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.flatMap((n) => {
    try {
      const v = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      return /^[a-z0-9][a-z0-9-]{0,39}$/.test(v.slug) && /^(dang-lam|xong)$/.test(v.status)
        ? [{ slug: v.slug, status: v.status, branch: String(v.branch ?? ''), kind: String(v.kind ?? '') }]
        : [];
    } catch { return []; }
  }).slice(0, 30);
}

/** Open Lavish review sessions (key + artifact path) from lavish-axi's state file; never the artifact itself. */
export function parseLavish(stateText) {
  let sessions;
  try { sessions = JSON.parse(stateText).sessions; } catch { return []; }
  if (!sessions || typeof sessions !== 'object') return [];
  return Object.values(sessions)
    .filter((s) => s && /^[a-f0-9]{8,64}$/.test(String(s.key)) && typeof s.file === 'string' && !/^(ended|closed)$/.test(String(s.status)))
    .map((s) => ({ key: s.key, file: s.file }))
    .slice(0, 20);
}

function lavishSessions() {
  // lavish-axi keeps a session "open" after its file is gone (worktree removed): list only artifacts that still exist.
  try { return parseLavish(readFileSync(join(process.env.HOME ?? ROOT, '.lavish-axi', 'state.json'), 'utf8')).filter((s) => existsSync(s.file)); } catch { return []; }
}


// Refresh origin/main and origin/staging at most every 5 minutes, not every 30 s report.
function refreshRemotes(repoRoots) {
  const stamp = join(process.env.HOME ?? '/tmp', '.fleet', 'last-fetch');
  try { if (Date.now() - statSync(stamp).mtimeMs < 300_000) return; } catch { /* first run */ }
  for (const root of repoRoots) git(root, 'fetch', '-q', 'origin', 'main', 'staging');
  writeFileSync(stamp, '');
}

// merge-tree is the slowest step of a report (seconds per checkout), and the local reporter repeats the scan every
// minute while most checkouts do not move: the answer is reused until HEAD or the ref's commit changes.
const contentInCache = new Map();

/** True when merging HEAD into `ref` changes nothing (content check: also catches squash merges). */
export function contentIn(path, ref, run = git) {
  const target = run(path, 'rev-parse', `${ref}^{tree}`);
  if (!target) return false;
  const key = `${path}\0${ref}\0${run(path, 'rev-parse', 'HEAD', `${ref}^{commit}`)}`;
  if (!contentInCache.has(key)) contentInCache.set(key, run(path, 'merge-tree', '--write-tree', ref, 'HEAD').split('\n')[0] === target);
  return contentInCache.get(key);
}

const LONG_LIVED_BRANCH = /^(main|master|develop|dev|stable|beta|release\/.+)$/;

/**
 * The repository's own default branch as a remote ref ("origin/master"), from origin/HEAD. Falls back to
 * origin/main when origin/HEAD is absent or points at a ref that does not exist: some repos have an unrelated
 * origin/main next to the real default branch, and measuring against it reports every file as changed.
 */
export function defaultBranch(path) {
  const ref = git(path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (!ref || !git(path, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)) return 'origin/main';
  return ref;
}

/**
 * Changed line ranges per file, in the coordinates of the merge base with the default branch, covering
 * committed and uncommitted edits. Line numbers only, never content. Approximate: machines on
 * different bases can be a few lines off; the local overlap.py merge-tree check is exact.
 */
export function changedRanges(path) {
  // A long-lived branch (main, release, stable...) is not work in flight: it carries commits its default branch lacks
  // (release cherry-picks) and may trail its upstream, so only what it holds beyond the fork point with its own
  // upstream counts: the upstream's newer commits are not this lane's edits.
  const upstream = LONG_LIVED_BRANCH.test(git(path, 'branch', '--show-current'))
    ? git(path, 'merge-base', '@{upstream}', 'HEAD')
    : '';
  const base = upstream || git(path, 'merge-base', defaultBranch(path), 'HEAD');
  if (!base) return [];
  const out = git(path, 'diff', '-U0', '--no-color', '--no-ext-diff', base, '--');
  const files = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('--- ')) { current = line === '--- /dev/null' ? null : line.slice(6); continue; }
    if (line.startsWith('+++ ') && current === null && line !== '+++ /dev/null') { current = line.slice(6); continue; }
    const hunk = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
    if (!hunk || current === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const ranges = files.get(current) ?? [];
    if (ranges.length < 20) ranges.push([Math.max(start, 1), Math.max(start, 1) + Math.max(count, 1) - 1]);
    files.set(current, ranges);
  }
  return [...files].slice(0, 200).map(([file, ranges]) => ({ path: file, ranges }));
}

export function repoFromOrigin(origin) {
  const text = String(origin ?? '').trim();
  const scp = /^(?:[^@/:]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?$/.exec(text);
  let host = scp?.[1] ?? '';
  let owner = scp?.[2] ?? '';
  let repository = scp?.[3] ?? '';
  if (scp === null) {
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' && url.protocol !== 'ssh:') return '';
      const [urlOwner, urlRepository, extra] = url.pathname.replace(/^\/+/, '').split('/');
      if (urlOwner === undefined || urlRepository === undefined || extra !== undefined) return '';
      host = url.host;
      owner = urlOwner;
      repository = urlRepository.replace(/\.git$/, '');
    } catch {
      return '';
    }
  }
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return '';
  return host.toLowerCase() === 'github.com' ? `${owner}/${repository}` : `${host}/${owner}/${repository}`;
}

function repos() {
  const roots = [];
  for (const name of readdirSync(ROOT)) {
    const dir = join(ROOT, name);
    if (existsSync(join(dir, '.git'))) roots.push(dir);
    // `wt/` holds the worktrees cloud-giao creates (wt/<repo>-<task>, or wt/<task>/<repo> for an all-repo task);
    // `*.worktrees/` the ones made by hand.
    if (name === 'wt' || name.endsWith('.worktrees')) {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (existsSync(join(path, '.git'))) roots.push(path);
        else if (name === 'wt' && statSync(path).isDirectory()) {
          for (const inner of readdirSync(path)) if (existsSync(join(path, inner, '.git'))) roots.push(join(path, inner));
        }
      }
    }
  }
  refreshRemotes(roots.filter((p) => existsSync(join(p, '.git')) && statSync(join(p, '.git')).isDirectory()));
  return roots.map((path) => {
    const counts = git(path, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD').split(/\s+/);
    const github_repo = repoFromOrigin(git(path, 'remote', 'get-url', 'origin'));
    const head = git(path, 'rev-parse', 'HEAD');
    const defaultRef = defaultBranch(path);
    // Field name kept for the hub and the board: the value is the head of the default branch, whatever its name.
    const origin_main = git(path, 'rev-parse', defaultRef);
    // The main checkout's folder name, also for worktrees (wt/backend-xep-san -> HethongBackendApi_...).
    const common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    return {
      path,
      repo: common ? basename(dirname(common)) : basename(path),
      branch: git(path, 'branch', '--show-current'),
      ...(github_repo === '' ? {} : { github_repo }),
      ...(head === '' ? {} : { head }),
      ...(origin_main === '' ? {} : { origin_main }),
      behind: Number(counts[0]) || 0,
      ahead: Number(counts[1]) || 0,
      merged: contentIn(path, defaultRef),
      staged: contentIn(path, 'origin/staging'),
      dirty_files: dirtyPaths(path),
      changes: changedRanges(path),
    };
  });
}

function diskFreeGb() {
  try {
    const { bavail, bsize } = statfsSync(ROOT);
    return Math.round((bavail * bsize) / 1e8) / 10;
  } catch { return null; }
}

/** The sync hash dong-bo-cloud.ps1 writes to ~/.skill-version (12 hex chars), or null when absent or malformed. */
export function readSkillVersion(file) {
  try {
    const text = readFileSync(file, 'utf8').trim();
    return /^[0-9a-f]{12}$/.test(text) ? text : null;
  } catch { return null; }
}

/**
 * Keep the report under the hub's 64 KB limit: drop per-file line ranges from the largest repos
 * first (dirty_files stay, so overlaps fall back to file level) and flag what was cut.
 */
export function fitReport(report, limit = 60_000) {
  const size = () => Buffer.byteLength(JSON.stringify(report));
  const byChanges = [...report.repos].sort((a, b) => (b.changes?.length ?? 0) - (a.changes?.length ?? 0));
  for (const repo of byChanges) {
    if (size() <= limit) break;
    if (repo.changes?.length) { repo.changes = []; repo.changes_truncated = true; }
  }
  for (const repo of report.repos) {
    if (size() <= limit) break;
    if (repo.dirty_files.length > 20) { repo.dirty_files = repo.dirty_files.slice(0, 20); repo.dirty_truncated = true; }
  }
  // Verdicts give way before repository rows do: the hub keeps at most 200 and rows are what the board lists.
  while (size() > limit && report.verdicts?.length > 0) report.verdicts.pop();
  // Last resort: keep only branch-level data, then drop repos from the end.
  for (const repo of report.repos) {
    if (size() <= limit) break;
    repo.dirty_files = []; repo.dirty_truncated = true;
  }
  while (size() > limit && report.repos.length > 0) { report.repos.pop(); report.repos_truncated = true; }
  if (size() > limit) throw new Error(`report still ${size()} bytes after trimming`);
  return report;
}

const GUARD_REPORT_LIMIT = 14_000;

/** Keep only bounded git-risk and worktree metadata for the board. */
export function summarizeGuard(guard) {
  const text = (value, max = 500) => String(value ?? '').slice(0, max);
  const number = (value) => Number.isFinite(value) ? value : 0;
  let worktreesRemaining = 100;
  const worktreeSummary = (worktree) => ({
    path: text(worktree.path),
    branch: worktree.branch === null ? null : text(worktree.branch, 256),
    head: text(worktree.head, 64),
    unpushed: number(worktree.unpushed),
    unpushedSubjects: (worktree.unpushedSubjects ?? []).slice(0, 5).map((subject) => text(subject, 200)),
    backedUp: worktree.backedUp === true,
    dirty: number(worktree.dirty),
    dirtyKnown: worktree.dirtyKnown === true,
    ignored: number(worktree.ignored),
    dirtyOldestMinutes: Number.isFinite(worktree.dirtyOldestMinutes)
      ? worktree.dirtyOldestMinutes
      : null,
    op: ['rebase', 'merge', 'cherry-pick', 'bisect'].includes(worktree.op) ? worktree.op : null,
    mergedToMain: worktree.mergedToMain === true,
    idleDays: number(worktree.idleDays),
    idleMinutes: number(worktree.idleMinutes),
    prunable: worktree.prunable === true,
  });
  const summary = {
    machine: text(guard.machine, 100),
    scannedAt: text(guard.scannedAt, 40),
    repos: (guard.repos ?? []).slice(0, 30).map((repo) => {
      const worktrees = (repo.worktrees ?? []).slice(0, worktreesRemaining).map(worktreeSummary);
      worktreesRemaining -= worktrees.length;
      return { repo: text(repo.repo), worktrees };
    }),
    risks: (guard.risks ?? []).slice(0, 100).map((risk) => ({
      level: risk.level === 'red' ? 'red' : 'yellow',
      kind: text(risk.kind, 32),
      repo: text(risk.repo),
      path: text(risk.path),
      detail: text(risk.detail, 300),
    })),
  };
  const size = () => Buffer.byteLength(JSON.stringify(summary));
  while (size() > GUARD_REPORT_LIMIT) {
    if (summary.risks.length) summary.risks.pop();
    else {
      const repo = summary.repos.at(-1);
      if (repo?.worktrees.length) repo.worktrees.pop();
      else if (summary.repos.length) summary.repos.pop();
      else break;
    }
  }
  return summary;
}

export function shouldBackupGuard(lastBackupAt, now = Date.now()) {
  return !Number.isFinite(lastBackupAt) || now - lastBackupAt >= GUARD_BACKUP_INTERVAL_MS;
}

export function shouldPruneGuard(
  lastPruneAt,
  now = Date.now(),
  enabled = process.env.GIT_GUARD_PRUNE !== '0',
) {
  return enabled && (!Number.isFinite(lastPruneAt) || now - lastPruneAt >= GUARD_PRUNE_INTERVAL_MS);
}

function lastPruneTime() {
  try {
    return statSync(GUARD_PRUNE_STAMP).mtimeMs;
  } catch {
    return NaN;
  }
}

function recordPruneAttempt() {
  try {
    mkdirSync(dirname(GUARD_PRUNE_STAMP), { recursive: true });
    writeFileSync(GUARD_PRUNE_STAMP, `${Date.now()}\n`, { mode: 0o600 });
  } catch {
    /* a missing local stamp only causes a later retry */
  }
}

function lastBackupTime() {
  try { return statSync(GUARD_BACKUP_STAMP).mtimeMs; } catch { return NaN; }
}

function recordBackupAttempt() {
  try {
    mkdirSync(dirname(GUARD_BACKUP_STAMP), { recursive: true });
    writeFileSync(GUARD_BACKUP_STAMP, `${Date.now()}\\n`, { mode: 0o600 });
  } catch { /* a missing local stamp only causes a later retry */ }
}

if (process.env.FLEET_ID) {
  const id = process.env.FLEET_ID;
  const sessionRows = sessions();
  const tmux = tmuxSessions();
  const taskBook = readTaskBook(join(process.env.HOME ?? ROOT, '.cloud-viec'));
  const repoRows = repos();
  const guardReport = await scan({ roots: [ROOT], machine: id });
  // Off by default: snapshots push code to GitHub (refs/wip) and judging fetches it, so a machine opts in with FLEET_SNAPSHOT=1.
  const snapshotsOn = process.env.FLEET_SNAPSHOT === '1';
  const judgeFile = join(process.env.HOME ?? ROOT, '.fleet', 'judge.json');
  let verdicts = [];
  if (snapshotsOn) {
    for (const row of repoRows) {
      try { snapshotLane(row.path, id); } catch (error) { console.error(`fleet-agent: snapshot ${row.path}: ${error.message}`); }
    }
    verdicts = collectVerdicts(loadJudgeList(judgeFile), repoRows, { budgetMs: 20_000 });
  }
  const token = signJwt(
    { iss: id, aud: 'fleet-hub', role: 'report' },
    readFileSync(process.env.FLEET_KEY, 'utf8'),
  );
  const res = await fetch(`${process.env.FLEET_HUB}/v1/report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(
      fitReport({
        agent_id: id,
        disk_free_gb: diskFreeGb(),
        skill_version: readSkillVersion(join(process.env.HOME ?? ROOT, '.skill-version')),
        sessions: sessionRows,
        tmux,
        lavish: lavishSessions(),
        viec: taskBook,
        repos: repoRows,
        guard: summarizeGuard(guardReport),
        verdicts,
      }),
    ),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ status: 0, text: async () => e.message }));
  // The hub's answer names the repositories this machine must judge; the next run uses it.
  if (snapshotsOn && res.status === 200) {
    try { saveJudgeList(judgeFile, (await res.json()).judge); } catch { /* keep the previous assignment */ }
  }
  if (process.env.GIT_GUARD_BACKUP !== '0' && shouldBackupGuard(lastBackupTime())) {
    try { backup(guardReport); }
    catch (error) { console.error(`fleet-agent: git guard backup failed: ${error.message}`); }
    recordBackupAttempt();
  }
  if (shouldPruneGuard(lastPruneTime())) {
    try {
      const result = prune(guardReport, {
        activePaths: [
          ...sessionRows.map((session) => session.cwd),
          ...tmux.map((session) => session.cwd),
        ].filter(Boolean),
        activeBranches: [
          ...tmux.map((session) => session.branch),
          ...taskBook.filter((task) => task.status === 'dang-lam').map((task) => task.branch),
        ].filter(Boolean),
        activeTaskSlugs: taskBook
          .filter((task) => task.status === 'dang-lam')
          .map((task) => task.slug),
      });
      if (result.removed > 0)
        console.log(`fleet-agent: git guard removed ${result.removed} worktree(s)`);
    } catch (error) {
      console.error(`fleet-agent: git guard prune failed: ${error.message}`);
    }
    recordPruneAttempt();
  }
  if (res.status !== 200) {
    console.error(`fleet-agent: hub ${res.status} ${await res.text()}`);
    process.exitCode = 1;
  }
}
