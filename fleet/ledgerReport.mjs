// A local report built from the activity ledger instead of scanning git: the ledger already records which file each
// session edited, in which checkout and branch. One SQL query per round, no git call per checkout (a git scan of all
// checkouts used 60-80% of this machine's CPU). The cost is precision: only files the ledger saw an agent write, and
// no line ranges. Enough to warn two agents off the same file.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fitReport, git, repoFromOrigin } from './agent.mjs';

export const LEDGER_WINDOW_MINUTES = 30;
// The hub keeps at most this many repos per machine (fleet/hub.mjs).
const HUB_REPO_LIMIT = 20;
export const DEFAULT_LEDGER = join(homedir(), '.omp', 'agent', 'activity.db');

const pad = (n) => String(n).padStart(2, '0');

/** The ledger stamps events in local time as `YYYY-MM-DD HH:MM:SS`. */
export function localStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const slashes = (path) => String(path).replace(/\\/g, '/');

/** One row per checkout with files written in the last `minutes`: `{ path, repo, branch, dirty_files }`. */
export function ledgerRows(ledgerPath, { now = Date.now(), minutes = LEDGER_WINDOW_MINUTES } = {}) {
  if (!existsSync(ledgerPath)) throw new Error(`activity ledger not found: ${ledgerPath}`);
  const db = new DatabaseSync(ledgerPath, { readOnly: true });
  let events;
  try {
    events = db.prepare(
      "SELECT DISTINCT repo, checkout, branch, path FROM events WHERE kind IN ('edit', 'write') AND checkout IS NOT NULL AND path IS NOT NULL AND ts >= ?",
    ).all(localStamp(now - minutes * 60_000));
  } finally {
    db.close();
  }
  const rows = new Map();
  for (const event of events) {
    const checkout = slashes(event.checkout).replace(/\/+$/, '');
    const path = slashes(event.path);
    // Case-insensitive prefix: Windows paths differ in drive-letter case between tools.
    if (!path.toLowerCase().startsWith(`${checkout.toLowerCase()}/`)) continue;
    const row = rows.get(checkout) ?? { path: checkout, repo: basename(slashes(event.repo ?? checkout)), branch: event.branch ?? '', dirty_files: [], mainRepo: slashes(event.repo ?? checkout) };
    row.dirty_files.push(path.slice(checkout.length + 1));
    rows.set(checkout, row);
  }
  return [...rows.values()];
}

// A checkout's origin does not change between rounds, so git is asked once per checkout for the life of the loop.
const gitOrigins = new Map();
const gitOrigin = (checkout) => {
  if (!gitOrigins.has(checkout)) gitOrigins.set(checkout, repoFromOrigin(git(checkout, 'remote', 'get-url', 'origin')));
  return gitOrigins.get(checkout);
};

/** The report the hub takes, from the ledger. `originOf(checkout)` gives the GitHub identity; it is asked once per repository. */
export function buildLedgerReport({ id, ledgerPath = DEFAULT_LEDGER, now = Date.now(), originOf = gitOrigin }) {
  const rows = ledgerRows(ledgerPath, { now });
  const originByRepo = new Map();
  const repos = rows
    .sort((a, b) => b.dirty_files.length - a.dirty_files.length)
    .slice(0, HUB_REPO_LIMIT)
    .map(({ mainRepo, ...row }) => {
      if (!originByRepo.has(mainRepo)) originByRepo.set(mainRepo, originOf(row.path));
      const githubRepo = originByRepo.get(mainRepo);
      return { ...row, ...(githubRepo ? { github_repo: githubRepo } : {}), changes: [] };
    });
  return fitReport({ agent_id: id, disk_free_gb: null, skill_version: null, sessions: [], tmux: [], lavish: [], viec: [], repos, guard: null });
}
