// local-agent: reports this computer's git worktrees (branch, dirty paths, changed line ranges) to the fleet hub
// the way the cloud agents do, so cloud sessions and the board can see what local work touches before they overlap.
// Sends paths and branch names only; never file content. Nothing is pushed, fetched or changed in any checkout.
//
// Config file (default ~/.pixel-agents/fleet-local.json):
//   { "hub": "https://...", "keyPath": "<private key PEM>", "roots": ["V:/pixel-agents", ...], "id": "local-pc" }
//   `roots` are main checkouts; every worktree of each root is reported.
// Usage: node fleet/local-agent.mjs --gen-key   create the key pair, print the PUBLIC key to register on the hub (role report)
//        node fleet/local-agent.mjs --once      send one report
//        node fleet/local-agent.mjs --loop      send one report every 60 s until stopped
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { changedRanges, contentIn, defaultBranch, dirtyPaths, fitReport, git, repoFromOrigin } from './agent.mjs';
import { signJwt } from './jwt.mjs';

export const LOCAL_REPORT_INTERVAL_MS = 60_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_CONFIG = join(homedir(), '.pixel-agents', 'fleet-local.json');
const DEFAULT_KEY = join(homedir(), '.pixel-agents', 'fleet-local-key.pem');

/** "local-<host>" with only characters the hub and the board accept in a machine name. */
export function localAgentId(host = hostname()) {
  const slug = String(host).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 33);
  return `local-${slug || 'pc'}`;
}

/** Validated config, or an Error naming the first problem. The key is only ever read at signing time. */
export function parseConfig(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('config is not valid JSON'); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object');
  let hub;
  try { hub = new URL(String(raw.hub)); } catch { throw new Error('config.hub must be a URL'); }
  if (hub.protocol !== 'https:') throw new Error('config.hub must be https');
  if (!Array.isArray(raw.roots) || raw.roots.length === 0 || !raw.roots.every((root) => typeof root === 'string' && root !== '')) {
    throw new Error('config.roots must list at least one repository folder');
  }
  const id = raw.id === undefined ? localAgentId() : String(raw.id);
  if (!ID_PATTERN.test(id)) throw new Error('config.id must match [a-z0-9-], at most 40 characters');
  return { hub: hub.origin, keyPath: typeof raw.keyPath === 'string' && raw.keyPath !== '' ? raw.keyPath : DEFAULT_KEY, roots: raw.roots, id };
}

/** The paths of the working trees of one repository (the root first); bare and prunable entries are skipped. */
export function parseWorktreeList(porcelain) {
  const paths = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length).trim();
    if (!path || lines.some((line) => line === 'bare' || line.startsWith('prunable'))) continue;
    paths.push(path);
  }
  return paths;
}

/** One report row for a working tree, shaped like the cloud agent's, from local refs only (no fetch). */
export function repoRow(path) {
  const counts = git(path, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD').split(/\s+/);
  const githubRepo = repoFromOrigin(git(path, 'remote', 'get-url', 'origin'));
  const head = git(path, 'rev-parse', 'HEAD');
  const defaultRef = defaultBranch(path);
  // Field name kept for the hub and the board: the value is the head of the default branch, whatever its name.
  const originMain = git(path, 'rev-parse', defaultRef);
  const common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return {
    path,
    repo: common ? basename(dirname(common)) : basename(path),
    branch: git(path, 'branch', '--show-current'),
    ...(githubRepo === '' ? {} : { github_repo: githubRepo }),
    ...(head === '' ? {} : { head }),
    ...(originMain === '' ? {} : { origin_main: originMain }),
    behind: Number(counts[0]) || 0,
    ahead: Number(counts[1]) || 0,
    merged: contentIn(path, defaultRef),
    staged: contentIn(path, 'origin/staging'),
    dirty_files: dirtyPaths(path),
    changes: changedRanges(path),
  };
}

export function buildReport({ id, roots }, rowOf = repoRow, listOf = (root) => parseWorktreeList(git(root, 'worktree', 'list', '--porcelain'))) {
  const seen = new Set();
  const repos = [];
  for (const root of roots) {
    for (const path of listOf(root)) {
      if (seen.has(path) || !existsSync(path)) continue;
      seen.add(path);
      repos.push(rowOf(path));
    }
  }
  // No sessions, tmux or guard here: the board already reads local sessions and git risk from its own ledger.
  return fitReport({ agent_id: id, disk_free_gb: null, skill_version: null, sessions: [], tmux: [], lavish: [], viec: [], repos, guard: null });
}

export async function sendReport(config, report, fetcher = fetch) {
  const token = signJwt({ iss: config.id, aud: 'fleet-hub', role: 'report' }, readFileSync(config.keyPath, 'utf8'));
  const response = await fetcher(new URL('/v1/report', config.hub), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) throw new Error(`hub ${response.status} ${await response.text()}`);
}

/** Creates the Ed25519 key once (mode 0600) and returns the public key PEM; an existing key is never replaced. */
export function ensureKey(keyPath) {
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true });
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  // Derived from the private key every time, so a missing .pub file can never leave the key unregistered.
  return createPublicKey(createPrivateKey(readFileSync(keyPath, 'utf8'))).export({ type: 'spki', format: 'pem' });
}

async function main(args) {
  const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : DEFAULT_CONFIG;
  if (args.includes('--gen-key')) {
    console.log(`Register this PUBLIC key on the hub as role "report" for id ${localAgentId()} (or your config.id):\n${ensureKey(DEFAULT_KEY)}`);
    return;
  }
  const config = parseConfig(readFileSync(configPath, 'utf8'));
  const once = async () => {
    try {
      await sendReport(config, buildReport(config));
      console.log(`local-agent: reported as ${config.id}`);
    } catch (error) {
      console.error(`local-agent: ${error.message}`);
      process.exitCode = 1;
    }
  };
  await once();
  // One report at a time: a slow scan must not overlap the next one.
  if (args.includes('--loop')) for (;;) { await new Promise((resolve) => setTimeout(resolve, LOCAL_REPORT_INTERVAL_MS)); await once(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main(process.argv.slice(2));
