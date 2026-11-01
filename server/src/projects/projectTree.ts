import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { type AgentEngine,agentEngineForKind } from '../../../core/src/agentEngines.js';
import type { LedgerOverlapScan, ProjectTreeNode } from '../../../core/src/messages.js';
import { listFolderRepos } from '../company/workItems/folderRepos.js';
import {
  LEDGER_DIFF_MAX_BYTES,
  LEDGER_DIFF_TIMEOUT_MS,
  LEDGER_GIT_MAX_BYTES,
} from '../ledger/constants.js';
import { type GitRepoScan, type GitRunner, type GitRunOptions, readRepo } from '../ledger/git.js';
import type { LedgerSource, SessionRow } from '../ledger/ledgerDb.js';
import { ledgerPathKey, normalizeLedgerPath } from '../ledger/ledgerPath.js';
import { formatLedgerTime, parseLedgerTime } from '../ledger/ledgerTime.js';
import type { AgentState } from '../types.js';
import { EDIT_KINDS } from './projectDiffEngine.js';
import { type Project, type ProjectNode, ProjectStore } from './projectStore.js';
import type { SessionProgress, TranscriptFacts } from './sessionProgress.js';

export interface ProjectSessionSnapshot {
  readonly engine: NonNullable<ProjectTreeNode['engine']>;
  readonly agentKind: NonNullable<ProjectTreeNode['agentKind']>;
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly cwd: string;
  /** Ledger sessions a board folder runs: that board session's id. */
  readonly boardSessionId?: string;
  /** The session that spawned this one, when the ledger links them. */
  readonly parentSessionId?: string;
  /** The herdr pane the session runs in, when herdr reports the same session. */
  readonly herdrPaneId?: string;
  /** The checkouts the session edited lately, newest first. */
  readonly editCheckouts?: readonly string[];
  /** The agent's own todo list, as its transcript last wrote it. */
  readonly progress?: SessionProgress;
  /** The user's first message in the transcript: what the session was asked to do. */
  readonly request?: string;
  /** The user's newest message, when it is not the first one. */
  readonly lastRequest?: string;
  /** The user's newest messages, newest first, at most five. */
  readonly recentRequests?: string[];
  /** The error that cut the agent's last turn off (a usage limit, a lost connection), while no answer followed it. */
  readonly interrupted?: string;
  /** The agent's newest answer with text in it, clipped: what it reported having done. */
  readonly lastReply?: string;
  /** The agent's own session id (what its resume takes), for a herdr pane that named its transcript. */
  readonly transcriptId?: string;
  /** When the session stopped: a sleeping pane's sleep, an ended session's exit (ISO). */
  readonly stoppedAt?: string;
}

/** A herdr pane; the transcript facts are filled in while the tree is built, from its `sessionFile`. */
export interface HerdrProjectSession extends TranscriptFacts {
  readonly id: string;
  readonly cwd: string;
  readonly status: string;
  readonly title: string;
  /** The agent's transcript, when it reported one to herdr; joins the pane to its ledger session. */
  readonly sessionFile?: string;
  /** The agent's session id, when it reported an id instead. */
  readonly sessionId?: string;
  /** When a sleeping pane was put to sleep (ISO); absent for a working pane. */
  readonly sleptAt?: string;
}

/** A herdr pane as its snapshot lists it, working (`agents`, with a status) or sleeping (with `sleptAt`). */
interface HerdrSnapshotPane {
  readonly paneId: string;
  readonly cwd?: string;
  readonly status?: string;
  readonly title?: string;
  readonly name?: string;
  readonly sessionFile?: string;
  readonly sessionId?: string;
  readonly sleptAt?: string;
}

/** herdr's panes (working and sleeping) as Project tree sessions; a pane with no cwd is left out. */
export function herdrProjectSessions(
  snapshot: { readonly agents: readonly HerdrSnapshotPane[]; readonly sleeping: readonly HerdrSnapshotPane[] } | undefined,
): HerdrProjectSession[] {
  if (snapshot === undefined) return [];
  const toSession = (pane: HerdrSnapshotPane): HerdrProjectSession[] => pane.cwd === undefined ? [] : [{
    id: pane.paneId,
    cwd: pane.cwd,
    status: pane.status ?? 'sleeping',
    title: pane.title ?? pane.name ?? '',
    ...(pane.sessionFile === undefined ? {} : { sessionFile: pane.sessionFile }),
    ...(pane.sessionId === undefined ? {} : { sessionId: pane.sessionId }),
    ...(pane.sleptAt === undefined ? {} : { sleptAt: pane.sleptAt }),
  }];
  return [...snapshot.agents.flatMap(toSession), ...snapshot.sleeping.flatMap(toSession)];
}

export interface ProjectTreeSnapshot {
  readonly nodes: ProjectTreeNode[];
}

export interface ProjectTreeOptions {
  readonly ledger: LedgerSource;
  readonly git: GitRunner;
  /** Whether a ledger session's process still runs; a session whose process is gone is left out. Unset keeps every live row. */
  readonly isAlive?: (pid: number) => boolean;
  readonly agents?: Iterable<AgentState>;
  readonly herdrSessions?: () => readonly HerdrProjectSession[];
  readonly overlapScans?: () => Promise<readonly LedgerOverlapScan[]>;
  readonly listRepos?: typeof listFolderRepos;
  /** Repo scan source; the ledger passes its cached scans. Defaults to a fresh read. */
  readonly readRepo?: (repo: string) => Promise<GitRepoScan>;
  /** Folders and their sessions only, no git: answers at once while the full tree builds. */
  readonly sessionsOnly?: boolean;
  /** The board session an open folder runs for an omp (native) session id, if any. */
  readonly boardSessionFor?: (nativeSessionId: string) => string | undefined;
  /** The todo progress and user requests a transcript last wrote. Unset leaves rows without them. */
  readonly sessionFacts?: (sessionFile: string) => Promise<TranscriptFacts>;
}
/** How far back a session's latest intent is looked up for its title. */
const SESSION_INTENT_WINDOW_MS = 6 * 60 * 60 * 1000;
/** How long an ended session stays in the tree, so the sidebar can tell which one stopped last. */
const ENDED_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** At most this many ended sessions stay, the newest ones. */
const ENDED_SESSIONS_MAX = 20;
/** The uuid a transcript file is named after: Claude `<uuid>.jsonl`, omp `<time>_<uuid>.jsonl`. */
const TRANSCRIPT_ID = /(?:^|_)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
function canonicalKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function pathContains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

type ProjectAgentKind = NonNullable<ProjectTreeNode['agentKind']>;
export function engineForLedger(row: SessionRow): AgentEngine {
  return agentEngineForKind(row.agentKind) ?? 'omp';
}

function agentKindForLedger(row: SessionRow): ProjectAgentKind {
  if (row.agentKind?.toLowerCase() === 'sub') return 'sub';
  return agentEngineForKind(row.agentKind) ?? 'omp';
}

/** A ledger session row with its latest intent, the board session behind it, its spawner, its herdr pane and its last edited checkout, when known. */
export type TitledSessionRow = SessionRow & {
  readonly intent?: string;
  readonly boardSessionId?: string;
  readonly parentSessionId?: string;
  readonly herdrPaneId?: string;
  readonly editCheckouts?: readonly string[];
  /** Path keys of the files the session edited lately; joins it to the changed files it owns. */
  readonly editFiles?: ReadonlySet<string>;
  readonly progress?: SessionProgress;
  readonly request?: string;
  readonly lastRequest?: string;
  readonly recentRequests?: string[];
  readonly interrupted?: string;
  readonly lastReply?: string;
};

/**
 * A subagent's task name (its transcript's file name, e.g. "ScoutWebAppUi"), else the
 * agent name when it says something, else what the session is doing now, else the
 * short session id.
 */
function titleForLedger(row: TitledSessionRow): string {
  const task = row.agentKind?.toLowerCase() === 'sub' && row.sessionFile
    ? (row.sessionFile.split(/[\\/]/).pop() ?? '').replace(/\.jsonl?$/i, '')
    : '';
  if (task !== '') return task;
  const name = row.agentName?.trim() ?? '';
  if (name !== '' && name !== 'main') return name;
  return row.intent ?? `…${row.sessionId.slice(-8)}`;
}

/** A transcript path compared case- and separator-blind, without its extension. */
function fileStem(file: string): string {
  return file.replace(/\\/g, '/').toLowerCase().replace(/\.jsonl?$/, '');
}

/**
 * The main sessions (no subagents) that ended, with their exit time, leaving out one a herdr pane
 * already lists as sleeping. A Claude session's transcript is named after its id, so a pane's file
 * name stands for an id too.
 */
export function endedMainRows<T extends SessionRow>(rows: readonly T[], panes: readonly HerdrProjectSession[]): { row: T; at: number }[] {
  const paneFiles = new Set(panes.flatMap((pane) => (pane.sessionFile === undefined ? [] : [fileStem(pane.sessionFile)])));
  const paneIds = new Set(panes.flatMap((pane) => [
    ...(pane.sessionId === undefined ? [] : [pane.sessionId.toLowerCase()]),
    ...(pane.sessionFile === undefined ? [] : [path.posix.basename(fileStem(pane.sessionFile))]),
  ]));
  return rows.flatMap((row) => {
    const at = parseLedgerTime(row.endedAt);
    if (at === null || agentKindForLedger(row) === 'sub') return [];
    if (paneIds.has(row.sessionId.toLowerCase()) || (row.sessionFile && paneFiles.has(fileStem(row.sessionFile)))) return [];
    return [{ row, at }];
  });
}

/** Live rows, plus the newest {@link ENDED_SESSIONS_MAX} main sessions that ended within a day (see {@link endedMainRows}). */
export function withRecentlyEnded(rows: readonly SessionRow[], panes: readonly HerdrProjectSession[], now: number): SessionRow[] {
  const ended = endedMainRows(rows, panes)
    .filter(({ at }) => now - at <= ENDED_SESSION_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, ENDED_SESSIONS_MAX);
  const kept = new Set(ended.map((entry) => entry.row));
  return rows.filter((row) => row.endedAt === null || kept.has(row));
}

/** An ended row's exit as ISO, for the node's `stoppedAt`. */
function endedAtIso(row: SessionRow): { stoppedAt?: string } {
  const at = parseLedgerTime(row.endedAt);
  return at === null ? {} : { stoppedAt: new Date(at).toISOString() };
}

/**
 * Each live session's spawner. A subagent's transcript sits in a folder named after
 * its parent's transcript, so the deepest live transcript whose stem prefixes the
 * file is the parent. A subagent without a file falls back to the live main session
 * of its process, but only when that process has exactly one: two would be a guess,
 * so it stays unlinked. The ledger's `parent_id` is an agent name, so it cannot link them.
 */
export function parentSessions(rows: readonly SessionRow[]): Map<string, string> {
  const live = rows.filter((row) => row.endedAt === null);
  const stems = live.flatMap((row) => (row.sessionFile ? [{ id: row.sessionId, stem: `${fileStem(row.sessionFile)}/` }] : []));
  const parents = new Map<string, string>();
  for (const row of live) {
    const file = row.sessionFile ? fileStem(row.sessionFile) : null;
    const byFile = file === null
      ? undefined
      : stems
        .filter((candidate) => candidate.id !== row.sessionId && file.startsWith(candidate.stem))
        .sort((a, b) => b.stem.length - a.stem.length)[0]?.id;
    const mains = byFile !== undefined || row.agentKind?.toLowerCase() !== 'sub' || row.pid === null
      ? []
      : live.filter((other) => other.pid === row.pid && other.agentKind?.toLowerCase() !== 'sub');
    const parent = byFile ?? (mains.length === 1 ? mains[0]?.sessionId : undefined);
    if (parent !== undefined) parents.set(row.sessionId, parent);
  }
  return parents;
}

/** Adds each session's latest non-empty intent and last edited checkout (last few hours), its board session id and its spawner. */
export function annotateLedgerRows(
  rows: readonly SessionRow[],
  ledger: LedgerSource,
  boardSessionFor: ((nativeSessionId: string) => string | undefined) | undefined,
): TitledSessionRow[] {
  const intents = new Map<string, string>();
  // Events come oldest first, so re-adding a checkout moves it to the end; reversed below, newest first.
  const edited = new Map<string, Set<string>>();
  const editedFiles = new Map<string, Set<string>>();
  for (const event of ledger.eventRows(formatLedgerTime(Date.now() - SESSION_INTENT_WINDOW_MS))) {
    const intent = event.intent?.trim();
    if (intent) intents.set(event.sessionId, intent);
    if (EDIT_KINDS.has(event.kind) && event.path !== null) {
      const files = editedFiles.get(event.sessionId) ?? new Set<string>();
      files.add(ledgerPathKey(event.path));
      editedFiles.set(event.sessionId, files);
    }
    if (!event.checkout) continue;
    const checkouts = edited.get(event.sessionId) ?? new Set<string>();
    checkouts.delete(event.checkout);
    checkouts.add(event.checkout);
    edited.set(event.sessionId, checkouts);
  }
  const parents = parentSessions(rows);
  return rows.map((row) => {
    const intent = intents.get(row.sessionId);
    const boardSessionId = row.endedAt === null ? boardSessionFor?.(row.sessionId) : undefined;
    const parentSessionId = parents.get(row.sessionId);
    const editCheckouts = [...(edited.get(row.sessionId) ?? [])].reverse();
    const editFiles = editedFiles.get(row.sessionId);
    return {
      ...row,
      ...(editFiles === undefined ? {} : { editFiles }),
      ...(intent === undefined ? {} : { intent }),
      ...(boardSessionId === undefined ? {} : { boardSessionId }),
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      ...(editCheckouts.length === 0 ? {} : { editCheckouts }),
    };
  });
}

/**
 * Joins each live ledger session to the herdr pane that reports the same session
 * (by transcript file, else by id). A joined pane is not listed again: its session's
 * row carries the pane id, so a click opens the pane's terminal.
 */
export function linkHerdrPanes(
  rows: readonly TitledSessionRow[],
  panes: readonly HerdrProjectSession[],
): { rows: TitledSessionRow[]; panes: HerdrProjectSession[] } {
  const byFile = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const pane of panes) {
    if (pane.sessionFile !== undefined) byFile.set(fileStem(pane.sessionFile), pane.id);
    if (pane.sessionId !== undefined) byId.set(pane.sessionId, pane.id);
  }
  const joined = new Set<string>();
  const linked = rows.map((row) => {
    if (row.endedAt !== null) return row;
    const paneId = (row.sessionFile ? byFile.get(fileStem(row.sessionFile)) : undefined) ?? byId.get(row.sessionId);
    if (paneId === undefined) return row;
    joined.add(paneId);
    return { ...row, herdrPaneId: paneId };
  });
  return { rows: linked, panes: panes.filter((pane) => !joined.has(pane.id)) };
}

/** What a Claude agent tracked by hooks shows: a permission prompt or a question waits on the user, else rest or work. */
export function boardAgentStatus(agent: Pick<AgentState, 'isWaiting' | 'permissionSent' | 'activeToolNames'>): string {
  if (agent.permissionSent) return 'permission';
  if ([...agent.activeToolNames.values()].includes('AskUserQuestion')) return 'waiting_input';
  return agent.isWaiting ? 'waiting' : 'running';
}

function ledgerStatus(row: SessionRow): string {
  if (row.endedAt !== null) return 'ended';
  const state = row.state?.toLowerCase();
  if (state === 'waiting' || state === 'waiting_input' || state === 'idle') return state;
  return 'running';
}

/**
 * Sessions working in `checkout`, and the recently ended ones {@link withRecentlyEnded} kept
 * (state `ended`, with `stoppedAt`). A cwd inside a nested checkout (a `.worktrees/<name>`
 * under the main one) belongs to that deeper checkout only. `placed` (the quick tree's
 * {@link placeWorktrees}) puts a linked worktree's cwd at its main repo.
 */
function sessionsForCheckout(
  checkout: string,
  nestedCheckouts: readonly string[],
  ledgerRows: readonly TitledSessionRow[],
  agents: readonly AgentState[],
  herdrSessions: readonly HerdrProjectSession[],
  placed?: ReadonlyMap<string, string>,
): ProjectSessionSnapshot[] {
  const owns = (cwd: string): boolean =>
    pathContains(checkout, placed?.get(canonicalKey(cwd)) ?? cwd) &&
    !nestedCheckouts.some((nested) => pathContains(nested, cwd));
  const sessions: ProjectSessionSnapshot[] = [];
  for (const row of ledgerRows) {
    if (row.cwd === null || !owns(row.cwd)) continue;
    sessions.push(ledgerSessionSnapshot(row, row.cwd));
  }
  for (const agent of agents) {
    if (!owns(agent.projectDir)) continue;
    sessions.push({
      engine: 'board',
      agentKind: 'board',
      id: agent.sessionId,
      status: boardAgentStatus(agent),
      title: agent.agentName ?? agent.teamName ?? '',
      cwd: agent.projectDir,
    });
  }
  for (const session of herdrSessions) {
    if (!owns(session.cwd)) continue;
    sessions.push(herdrSessionSnapshot(session));
  }
  return sessions;
}

/** A ledger row as a tree session; `cwd` is the row's own folder, already known not to be null. */
export function ledgerSessionSnapshot(row: TitledSessionRow, cwd: string): ProjectSessionSnapshot {
  return {
    engine: engineForLedger(row),
    agentKind: agentKindForLedger(row),
    id: row.sessionId,
    status: ledgerStatus(row),
    title: titleForLedger(row),
    cwd,
    ...(row.boardSessionId === undefined ? {} : { boardSessionId: row.boardSessionId }),
    ...(row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId }),
    ...(row.herdrPaneId === undefined ? {} : { herdrPaneId: row.herdrPaneId }),
    ...(row.editCheckouts === undefined ? {} : { editCheckouts: row.editCheckouts }),
    ...factFields(row),
    ...endedAtIso(row),
  };
}

/** A herdr pane as a tree session. */
export function herdrSessionSnapshot(session: HerdrProjectSession): ProjectSessionSnapshot {
  return {
    engine: 'herdr', agentKind: 'herdr', id: session.id, cwd: session.cwd, status: session.status, title: session.title,
    ...factFields(session),
    ...(session.sleptAt === undefined ? {} : { stoppedAt: session.sleptAt }),
    ...transcriptIdOf(session),
  };
}

const NUMSTAT_OPTIONS: GitRunOptions = {
  timeoutMs: LEDGER_DIFF_TIMEOUT_MS,
  okCodes: [0],
  maxBytes: LEDGER_DIFF_MAX_BYTES,
};
const UNTRACKED_STAT_OPTIONS: GitRunOptions = {
  ...NUMSTAT_OPTIONS,
  okCodes: [0, 1],
  maxBytes: LEDGER_GIT_MAX_BYTES,
};
/** New files whose lines are counted per checkout; the rest still list as changed-without-count. */
const UNTRACKED_COUNT_LIMIT = 200;
/** Checkouts of one repo whose change counts are read at once. */
const CHANGED_FILES_CONCURRENCY = 4;

interface FileChangeCount {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** Repos under a folder change rarely, and walking a large folder takes seconds. */
const REPO_LIST_REUSE_MS = 60_000;
/**
 * Change counts (2 git calls per dirty checkout) are re-read at most this often. The tree rebuilds
 * on every session status change; repo scans themselves come from the ledger's shared cache.
 */
const CHANGED_FILES_REUSE_MS = 20_000;

interface Reused<T> {
  readonly at: number;
  readonly value: Promise<T>;
}
const repoLists = new Map<string, Reused<string[]>>();
const changeCounts = new Map<string, Reused<FileChangeCount[]>>();

/** After a change the user made (new worktree, commit from the board), the next tree recounts changes. */
export function forgetChangeCounts(): void {
  changeCounts.clear();
}

/** `load` result for `key`, reused for `ttlMs`; a failed load is dropped so the next call retries. */
function reuse<T>(cache: Map<string, Reused<T>>, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < ttlMs) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

interface NodeAggregate {
  additions: number;
  deletions: number;
  overlap: boolean;
  overlappingWorktrees: Set<string>;
  pendingWork: boolean;
}

interface CheckoutOverlap {
  readonly worktrees: Set<string>;
  readonly files: Set<string>;
}

function emptyAggregate(): NodeAggregate {
  return { additions: 0, deletions: 0, overlap: false, overlappingWorktrees: new Set(), pendingWork: false };
}

function validRelativeFile(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes('\0') || path.isAbsolute(filePath)) return false;
  return !filePath.split(/[\\/]/).some((part) => part === '..');
}

function numberFromNumstat(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : 0;
}

function parseNumstat(stdout: string): FileChangeCount[] {
  const files: FileChangeCount[] = [];
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue;
    const fields = record.split('\t');
    if (fields.length < 3) continue;
    const filePath = fields.slice(2).join('\t');
    if (!validRelativeFile(filePath)) continue;
    files.push({
      path: filePath,
      additions: numberFromNumstat(fields[0]),
      deletions: numberFromNumstat(fields[1]),
    });
  }
  return files;
}

async function changedFiles(git: GitRunner, checkout: string): Promise<FileChangeCount[]> {
  const tracked = await git.run(checkout, ['diff', '--numstat', '-z', '--no-renames', 'HEAD', '--'], NUMSTAT_OPTIONS);
  if (!tracked.ok || tracked.truncated) return [];
  const files = new Map(parseNumstat(tracked.stdout).map((file) => [file.path, file]));
  const untracked = await git.run(
    checkout,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { ...UNTRACKED_STAT_OPTIONS, okCodes: [0] },
  );
  if (!untracked.ok || untracked.truncated) return [...files.values()];
  const fresh = untracked.stdout
    .split('\0')
    .filter((filePath) => validRelativeFile(filePath) && !files.has(filePath));
  // Counted in-process: one git spawn per new file made large worktrees take minutes.
  for (const [index, filePath] of fresh.entries()) {
    const additions = index < UNTRACKED_COUNT_LIMIT ? await countFileLines(path.join(checkout, filePath)) : 0;
    files.set(filePath, { path: filePath, additions, deletions: 0 });
  }
  return [...files.values()];
}

/** Lines a new file adds; 0 for binary, unreadable or oversized files. */
async function countFileLines(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > LEDGER_DIFF_MAX_BYTES) return 0;
    const content = await fs.readFile(filePath);
    if (content.includes(0)) return 0;
    let lines = 0;
    for (const byte of content) if (byte === 0x0a) lines += 1;
    return content.length > 0 && content[content.length - 1] !== 0x0a ? lines + 1 : lines;
  } catch {
    return 0;
  }
}

/** Runs `task` over `items` with at most `limit` in flight, keeping input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The main repo behind `candidate`: a linked worktree (`.git` file pointing at
 * `<main>/.git/worktrees/<name>`) gives its main repo. Any other path stands for
 * itself; other `.git` files (submodules point into `.git/modules/...`) are repos
 * of their own.
 */
async function mainRepoOf(candidate: string): Promise<string> {
  try {
    const dotGit = path.join(candidate, '.git');
    if (!(await fs.stat(dotGit)).isFile()) return candidate;
    const match = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(dotGit, 'utf8'));
    const adminDir = match?.[1] === undefined ? undefined : path.resolve(candidate, match[1].trim());
    const worktreesDir = adminDir === undefined ? undefined : path.dirname(adminDir);
    if (
      worktreesDir !== undefined &&
      path.basename(worktreesDir) === 'worktrees' &&
      path.basename(path.dirname(worktreesDir)) === '.git'
    ) {
      return path.dirname(path.dirname(worktreesDir));
    }
  } catch {
    // No or unreadable .git: the path stands for itself.
  }
  return candidate;
}

/**
 * The main repos behind `paths`, each once: scanning every worktree as its own
 * repo re-read all sibling worktrees each time (quadratic).
 */
async function mainRepos(paths: readonly string[]): Promise<string[]> {
  const mains = new Map<string, string>();
  for (const candidate of paths) {
    const main = await mainRepoOf(candidate);
    mains.set(canonicalKey(main), main);
  }
  return [...mains.values()];
}

/** Session cwd (canonical key) → its main repo; only linked worktrees are kept. Stable, so read once per cwd. */
const worktreeMains = new Map<string, string | null>();

/**
 * Where the quick tree places each cwd that is a linked worktree: at its main repo. Without the
 * git scan, a worktree beside its folder (`<repo>.worktrees/<name>`) would belong to no folder,
 * and its sessions (a sleeping one to wake above all) would vanish from the sidebar.
 */
async function placeWorktrees(cwds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unread = [...new Set(cwds.map(canonicalKey))].filter((key) => !worktreeMains.has(key));
  const byKey = new Map(cwds.map((cwd) => [canonicalKey(cwd), cwd]));
  await mapLimit(unread, CHANGED_FILES_CONCURRENCY, async (key) => {
    const cwd = byKey.get(key) ?? key;
    const main = await mainRepoOf(cwd);
    worktreeMains.set(key, main === cwd ? null : main);
  });
  const placed = new Map<string, string>();
  for (const key of byKey.keys()) {
    const main = worktreeMains.get(key);
    if (main !== undefined && main !== null) placed.set(key, main);
  }
  return placed;
}

function overlapForCheckout(
  checkout: string,
  scans: readonly LedgerOverlapScan[],
): CheckoutOverlap {
  const result: CheckoutOverlap = { worktrees: new Set(), files: new Set() };
  const key = canonicalKey(checkout);
  for (const scan of scans) {
    for (const pair of scan.pairs) {
      if (pair.conflicts.length === 0) continue;
      const a = canonicalKey(pair.a);
      const b = canonicalKey(pair.b);
      if (a !== key && b !== key) continue;
      result.worktrees.add(normalizeLedgerPath(a === key ? pair.b : pair.a));
      for (const conflict of pair.conflicts) {
        result.files.add(conflict.file.replaceAll(path.sep, '/'));
      }
    }
  }
  return result;
}

function applyAggregates(nodes: ProjectTreeNode[], aggregates: Map<string, NodeAggregate>): void {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    const aggregate = aggregates.get(node.id) ?? emptyAggregate();
    if (node.parentId !== undefined) {
      const parent = aggregates.get(node.parentId) ?? emptyAggregate();
      parent.additions += aggregate.additions;
      parent.deletions += aggregate.deletions;
      parent.overlap ||= aggregate.overlap;
      parent.pendingWork ||= aggregate.pendingWork;
      for (const worktree of aggregate.overlappingWorktrees) parent.overlappingWorktrees.add(worktree);
      aggregates.set(node.parentId, parent);
    }
    aggregates.set(node.id, aggregate);
    node.additions = aggregate.additions;
    node.deletions = aggregate.deletions;
    node.overlap = aggregate.overlap;
    node.pendingWork = aggregate.pendingWork;
    if (aggregate.overlappingWorktrees.size > 0) {
      node.overlappingWorktrees = [...aggregate.overlappingWorktrees];
    }
  }
}
/**
 * A session's own lines: the changed files it edited, summed. A checkout's total is shared by every
 * session working in it, so each session gets only the files its edits name (a file two sessions
 * edited counts for both). Runs after `applyAggregates` so these never roll up into the checkout.
 */
function attachSessionChanges(nodes: ProjectTreeNode[], ledgerRows: readonly TitledSessionRow[]): void {
  const filesOf = new Map(ledgerRows.flatMap((row) => (row.editFiles === undefined ? [] : [[row.sessionId, row.editFiles] as const])));
  if (filesOf.size === 0) return;
  const changed = nodes.filter((node) => node.kind === 'file-agg' && node.path !== undefined);
  for (const node of nodes) {
    const files = node.kind === 'session' && node.sessionId !== undefined ? filesOf.get(node.sessionId) : undefined;
    if (files === undefined) continue;
    let additions = 0;
    let deletions = 0;
    for (const file of changed) {
      if (!files.has(ledgerPathKey(file.path ?? ''))) continue;
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    node.additions = additions;
    node.deletions = deletions;
  }
}

async function appendNodes(
  nodes: readonly ProjectNode[],
  parentId: string,
  options: ProjectTreeOptions,
  ledgerRows: readonly TitledSessionRow[],
  agents: readonly AgentState[],
  herdrSessions: readonly HerdrProjectSession[],
  /** The quick tree's linked-worktree cwds placed at their main repo; undefined in the full tree. */
  placed: ReadonlyMap<string, string> | undefined,
  overlapScans: readonly LedgerOverlapScan[],
  pendingCheckouts: ReadonlySet<string>,
  aggregates: Map<string, NodeAggregate>,
  output: ProjectTreeNode[],
): Promise<void> {
  for (const node of nodes) {
    if (node.type === 'group') {
      output.push({ id: node.id, parentId, kind: 'group', name: node.name });
      await appendNodes(
        node.children, node.id, options, ledgerRows, agents, herdrSessions, placed,
        overlapScans, pendingCheckouts, aggregates, output,
      );
      continue;
    }

    output.push({ id: node.id, parentId, kind: 'folder', name: node.name, path: node.path });
    if (options.sessionsOnly === true) {
      pushSessions(output, node.id, sessionsForCheckout(node.path, [], ledgerRows, agents, herdrSessions, placed));
      continue;
    }
    const listed = options.listRepos === undefined
      ? await reuse(repoLists, canonicalKey(node.path), REPO_LIST_REUSE_MS, () => listFolderRepos(node.path))
      : await options.listRepos(node.path);
    const repos = await mainRepos(listed);
    const scanRepo = options.readRepo ?? ((repo: string) => readRepo(options.git, repo));
    const scans = await mapLimit(repos, CHANGED_FILES_CONCURRENCY, scanRepo);
    // Sessions in the folder but in no checkout (a plain folder, a non-repo subfolder) belong to the folder.
    const checkoutPaths = scans.flatMap((scan) => (scan.kind === 'repo' ? scan.worktrees.map((worktree) => worktree.path) : []));
    pushSessions(output, node.id, sessionsForCheckout(node.path, checkoutPaths, ledgerRows, agents, herdrSessions));
    for (const [repoIndex, repoPath] of repos.entries()) {
      const scan = scans[repoIndex] ?? { kind: 'not-repo' as const };
      if (scan.kind !== 'repo') continue;
      const mainCheckout = scan.worktrees.find((worktree) => worktree.isMain);
      if (mainCheckout === undefined || canonicalKey(mainCheckout.path) !== canonicalKey(repoPath)) continue;

      const repoId = repoPath;
      output.push({
        id: repoId, parentId: node.id, kind: 'repository', name: path.basename(repoPath), path: repoPath,
      });
      aggregates.set(repoId, emptyAggregate());
      // A clean checkout has nothing to count: skip its two git calls.
      const changes = await mapLimit(scan.worktrees, CHANGED_FILES_CONCURRENCY, (worktree) =>
        worktree.dirtyCount > 0
          ? reuse(changeCounts, canonicalKey(worktree.path), CHANGED_FILES_REUSE_MS, () => changedFiles(options.git, worktree.path))
          : Promise.resolve([]),
      );
      for (const [worktreeIndex, worktree] of scan.worktrees.entries()) {
        const overlap = overlapForCheckout(worktree.path, overlapScans);
        output.push({
          id: worktree.path,
          parentId: repoId,
          kind: 'checkout',
          name: worktree.name,
          path: worktree.path,
          ...(worktree.branch === null ? {} : { branch: worktree.branch }),
          dirty: worktree.dirtyCount > 0,
          ahead: worktree.ahead,
          behind: worktree.behind,
        });
        aggregates.set(worktree.path, {
          additions: 0,
          deletions: 0,
          overlap: overlap.worktrees.size > 0,
          overlappingWorktrees: new Set(overlap.worktrees),
          pendingWork: pendingCheckouts.has(canonicalKey(worktree.path)),
        });

        const files = changes[worktreeIndex] ?? [];
        for (const file of files) {
          const fileId = `file:${worktree.path}:${file.path}`;
          const normalizedFile = file.path.replaceAll(path.sep, '/');
          const fileOverlap = overlap.files.has(normalizedFile);
          output.push({
            id: fileId,
            parentId: worktree.path,
            kind: 'file-agg',
            name: path.basename(file.path),
            path: path.resolve(worktree.path, file.path),
            overlap: fileOverlap,
          });
          aggregates.set(fileId, {
            additions: file.additions,
            deletions: file.deletions,
            overlap: fileOverlap,
            overlappingWorktrees: fileOverlap ? new Set(overlap.worktrees) : new Set(),
            pendingWork: false,
          });
        }

        const nested = scan.worktrees
          .map((other) => other.path)
          .filter((other) => canonicalKey(other) !== canonicalKey(worktree.path) && pathContains(worktree.path, other));
        pushSessions(output, worktree.path, sessionsForCheckout(worktree.path, nested, ledgerRows, agents, herdrSessions));
      }
    }
  }
}

export function pushSessions(output: ProjectTreeNode[], parentId: string, sessions: readonly ProjectSessionSnapshot[]): void {
  for (const session of sessions) {
    output.push({
      id: `${session.agentKind}:${session.id}`,
      parentId,
      kind: 'session',
      name: session.title || session.id,
      engine: session.engine,
      agentKind: session.agentKind,
      sessionId: session.id,
      state: session.status,
      title: session.title,
      path: session.cwd,
      ...(session.boardSessionId === undefined ? {} : { boardSessionId: session.boardSessionId }),
      ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
      ...(session.herdrPaneId === undefined ? {} : { herdrPaneId: session.herdrPaneId }),
      ...(session.editCheckouts === undefined ? {} : { editCheckouts: [...session.editCheckouts] }),
      ...factFields(session),
      ...(session.stoppedAt === undefined ? {} : { stoppedAt: session.stoppedAt }),
      ...(session.transcriptId === undefined ? {} : { transcriptId: session.transcriptId }),
    });
  }
}

/**
 * A live ledger row whose process is gone was killed (a closed terminal, a crash): it never recorded
 * its own end, so the ledger would list it as working. It ends when it was last seen instead, so
 * "Vừa ngủ / tắt" lists it and it can be woken; one with no time at all is dropped.
 */
export function withDeadProcessesEnded(rows: readonly SessionRow[], isAlive: ((pid: number) => boolean) | undefined): readonly SessionRow[] {
  if (isAlive === undefined) return rows;
  return rows.flatMap((row) => {
    if (row.endedAt !== null || row.pid === null || isAlive(row.pid)) return [row];
    const endedAt = row.lastSeen ?? row.heartbeat ?? row.startedAt;
    return endedAt === null ? [] : [{ ...row, endedAt }];
  });
}

/**
 * Rows (live and recently ended) with what their transcript last wrote: todo progress, requests, a
 * cut-off turn. A Claude row the ledger gives no file is read by its session id; an unreadable
 * transcript gives none.
 */
export async function withProgress(
  rows: readonly TitledSessionRow[],
  read: ProjectTreeOptions['sessionFacts'],
): Promise<readonly TitledSessionRow[]> {
  if (read === undefined) return rows;
  return Promise.all(rows.map(async (row) => {
    const source = row.sessionFile || (engineForLedger(row) === 'claude' ? row.sessionId : '');
    if (source === '') return row;
    return { ...row, ...factFields(await read(source).catch((): TranscriptFacts => ({}))) };
  }));
}

/** The facts that are set, so a row or pane carries no field for an unset one. */
function factFields(facts: TranscriptFacts): TranscriptFacts {
  return {
    ...(facts.progress === undefined ? {} : { progress: facts.progress }),
    ...(facts.request === undefined ? {} : { request: facts.request }),
    ...(facts.lastRequest === undefined ? {} : { lastRequest: facts.lastRequest }),
    ...(facts.recentRequests === undefined ? {} : { recentRequests: facts.recentRequests }),
    ...(facts.interrupted === undefined ? {} : { interrupted: facts.interrupted }),
    ...(facts.lastReply === undefined ? {} : { lastReply: facts.lastReply }),
  };
}

/** A pane's session id: the one it reported, else the uuid its transcript file is named after. */
function transcriptIdOf(pane: HerdrProjectSession): { transcriptId?: string } {
  const fromFile = pane.sessionFile === undefined ? undefined : TRANSCRIPT_ID.exec(path.basename(pane.sessionFile))?.[1];
  const id = pane.sessionId ?? fromFile;
  return id === undefined ? {} : { transcriptId: id };
}

/**
 * Panes no live ledger session joined (a sleeping one above all) with what their transcript says
 * they were doing, so a sleeping session can be found again by its task.
 */
export async function withPaneFacts(
  panes: readonly HerdrProjectSession[],
  read: ProjectTreeOptions['sessionFacts'],
): Promise<readonly HerdrProjectSession[]> {
  if (read === undefined) return panes;
  return Promise.all(panes.map(async (pane) => {
    if (pane.sessionFile === undefined) return pane;
    return { ...pane, ...factFields(await read(pane.sessionFile).catch((): TranscriptFacts => ({}))) };
  }));
}

export async function buildProjectTreeSnapshot(
  store: ProjectStore,
  options: ProjectTreeOptions,
): Promise<ProjectTreeSnapshot> {
  const state = await store.load();
  const panes = options.herdrSessions?.() ?? [];
  const rows = withRecentlyEnded(withDeadProcessesEnded(options.ledger.sessionRows(), options.isAlive), panes, Date.now());
  const linked = linkHerdrPanes(annotateLedgerRows(rows, options.ledger, options.boardSessionFor), panes);
  const ledgerRows = await withProgress(linked.rows, options.sessionFacts);
  const pendingCheckouts = new Set(options.ledger.pendingRows().map((row) => canonicalKey(row.checkout)));
  const overlapScans = options.sessionsOnly === true ? [] : await (options.overlapScans?.() ?? Promise.resolve([]));
  const agents = [...(options.agents ?? [])];
  const herdrSessions = await withPaneFacts(linked.panes, options.sessionFacts);
  const placed = options.sessionsOnly === true
    ? await placeWorktrees([
      ...ledgerRows.flatMap((row) => (row.cwd === null ? [] : [row.cwd])),
      ...agents.map((agent) => agent.projectDir),
      ...herdrSessions.map((session) => session.cwd),
    ])
    : undefined;
  const nodes: ProjectTreeNode[] = [];
  const aggregates = new Map<string, NodeAggregate>();
  for (const project of state.projects) {
    nodes.push({
      id: project.id, kind: 'project', name: project.name, color: project.color,
    });
    await appendNodes(
      project.children, project.id, options, ledgerRows, agents, herdrSessions, placed,
      overlapScans, pendingCheckouts, aggregates, nodes,
    );
  }
  applyAggregates(nodes, aggregates);
  attachSessionChanges(nodes, ledgerRows);
  return { nodes };
}
export function findProjectForPath(projects: readonly Project[], folderPath: string): Project | undefined {
  const key = canonicalKey(folderPath);
  return projects.find((project) => {
    let found = false;
    const visit = (nodes: readonly ProjectNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'folder' && canonicalKey(node.path) === key) found = true;
        if (node.type === 'group') visit(node.children);
      }
    };
    visit(project.children);
    return found;
  });
}
