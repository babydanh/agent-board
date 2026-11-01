import type { FleetMachineSnapshot, ProjectTreeNode } from '../../../../core/src/messages.js';
import { cloudFolderKey, type CloudFolders, type CloudPlaceNode, placeCloudRows } from './cloudFolders.js';
import type { PendingCloudRow } from './cloudRows.js';

/**
 * Cloud agents as ordinary session rows of the Project tree: the tree draws, filters, counts and lists them as it does
 * a local session, so a cloud session needs no row of its own. Only the id says where a node comes from.
 */
export const CLOUD_NODE_PREFIX = 'cloud:';
/** The group holding cloud sessions that no folder claims. */
export const CLOUD_OTHER_ID = 'cloud:other';
const CLOUD_OTHER_NAME = 'Cloud khác';

/** A cloud session active within this many seconds is working; later it rests. */
const WORKING_WITHIN_S = 60;
/** What the board says when a sleeping row's machine is paused; the button that starts it shows only under exactly this text. */
export function pausedMachineNotice(machine: string): string {
  return `Máy ${machine} đang tạm dừng (hub không nhận tin từ máy hơn 10 phút).`;
}

/** A session gone from its machine stays listed as asleep this long, like a local session that exited. */
export const CLOUD_SEEN_KEEP_MS = 24 * 60 * 60 * 1000;
/** A live session's "last seen" is rewritten at most this often, so storage is not rewritten on every refresh. */
const CLOUD_SEEN_TOUCH_MS = 60_000;

export function cloudNodeId(machine: string, session: string): string {
  return `${CLOUD_NODE_PREFIX}${cloudFolderKey(machine, session)}`;
}

export function parseCloudNodeId(id: string): { readonly machine: string; readonly session: string } | null {
  if (!id.startsWith(CLOUD_NODE_PREFIX) || id === CLOUD_OTHER_ID) return null;
  const key = id.slice(CLOUD_NODE_PREFIX.length);
  const slash = key.indexOf('/');
  return slash <= 0 || slash === key.length - 1 ? null : { machine: key.slice(0, slash), session: key.slice(slash + 1) };
}

/** What the board remembers of a cloud session it saw, to show it asleep once its tmux session is gone. */
export interface CloudSeenEntry {
  readonly machine: string;
  readonly session: string;
  readonly folder?: string;
  readonly branch?: string;
  readonly path?: string;
  readonly lastSeen: number;
}
export type CloudSeen = Readonly<Record<string, CloudSeenEntry>>;

export const CLOUD_SEEN_KEY = 'omp.company.cloudSeen';

/** Stored entries that are not exactly what this module wrote are dropped: a hand-edited or damaged value must not break the tree. */
export function parseCloudSeen(raw: string | null): CloudSeen {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, CloudSeenEntry] => isSeenEntry(entry[0], entry[1])));
  } catch {
    return {};
  }
}

export function readCloudSeen(): CloudSeen {
  try {
    return parseCloudSeen(window.localStorage.getItem(CLOUD_SEEN_KEY));
  } catch {
    return {};
  }
}

export function writeCloudSeen(seen: CloudSeen): void {
  try {
    window.localStorage.setItem(CLOUD_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage is optional in embedded and restricted browser contexts.
  }
}

/** The largest time a Date can hold; a bigger "last seen" would throw when shown. */
const MAX_DATE_MS = 8.64e15;

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSeenEntry(key: string, value: unknown): value is CloudSeenEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.machine === 'string' &&
    typeof entry.session === 'string' &&
    key === cloudFolderKey(entry.machine, entry.session) &&
    typeof entry.lastSeen === 'number' &&
    Math.abs(entry.lastSeen) <= MAX_DATE_MS &&
    optionalString(entry.folder) &&
    optionalString(entry.branch) &&
    optionalString(entry.path)
  );
}

type CloudRepo = FleetMachineSnapshot['repos'][number];

interface CloudRow {
  readonly machine: string;
  readonly session: string;
  readonly state: 'working' | 'idle' | 'sleeping';
  readonly branch?: string;
  readonly path?: string;
  readonly repos: readonly CloudRepo[];
  readonly lastSeen?: number;
  readonly starting?: boolean;
  /** The session's pane shows a menu waiting for the user's choice. */
  readonly asking?: boolean;
  /** The user's last prompts to it, newest first. */
  readonly recentRequests?: readonly string[];
}

/** The machines whose tmux listing is current: only they can say a session is gone. */
function reporting(machines: readonly FleetMachineSnapshot[]): FleetMachineSnapshot[] {
  return machines.filter((machine) => machine.state === 'online' && machine.tmuxSessions !== undefined);
}

function liveRows(machines: readonly FleetMachineSnapshot[]): CloudRow[] {
  return machines.flatMap((machine) =>
    (machine.tmuxSessions ?? []).map((session) => {
      const repos = session.branch ? machine.repos.filter((repo) => repo.branch === session.branch && repo.path) : [];
      // Only a repository of the session can show changes: a bare tmux working directory is not one.
      const path = repos[0]?.path;
      // A machine that stopped reporting is paused or gone: what it last listed is old news and its terminal cannot open.
      const reachable = machine.state === 'online';
      return {
        machine: machine.agentId,
        session: session.name,
        state: !reachable ? ('sleeping' as const) : session.idleSeconds < WORKING_WITHIN_S ? ('working' as const) : ('idle' as const),
        repos,
        ...(!reachable ? { lastSeen: machine.receivedAt } : {}),
        ...(reachable && session.asking === true ? { asking: true } : {}),
        ...(reachable && session.recentRequests !== undefined && session.recentRequests.length > 0 ? { recentRequests: session.recentRequests } : {}),
        ...(session.branch ? { branch: session.branch } : {}),
        ...(path ? { path } : {}),
      };
    }),
  );
}

/** Machine "danh" must not claim branch cloud/danh-x-foo when a machine named "danh-x" exists: that branch is its. */
function ownedByLongerName(branch: string, own: string, machines: readonly FleetMachineSnapshot[]): boolean {
  return machines.some((other) => other.agentId !== own && other.agentId.startsWith(`${own}-`) && branch.startsWith(`cloud/${other.agentId}-`));
}

/** Work a finished or killed task left on its cloud branch: unmerged, and with commits or uncommitted files on it. */
function leftoverRows(machines: readonly FleetMachineSnapshot[], taken: ReadonlySet<string>, liveBranches: ReadonlySet<string>): CloudRow[] {
  return reporting(machines).flatMap((machine) => {
    const prefix = `cloud/${machine.agentId}-`;
    const byBranch = new Map<string, CloudRepo[]>();
    for (const repo of machine.repos) {
      const slug = repo.branch.startsWith(prefix) ? repo.branch.slice(prefix.length) : '';
      if (slug === '' || ownedByLongerName(repo.branch, machine.agentId, machines) || repo.merged === true || (repo.ahead <= 0 && repo.dirtyCount <= 0)) continue;
      if (liveBranches.has(repo.branch) || taken.has(cloudFolderKey(machine.agentId, slug))) continue;
      byBranch.set(repo.branch, [...(byBranch.get(repo.branch) ?? []), repo]);
    }
    return [...byBranch].map(([branch, repos]) => ({
      machine: machine.agentId,
      session: branch.slice(prefix.length),
      state: 'sleeping' as const,
      branch,
      repos,
      ...(repos[0]?.path ? { path: repos[0].path } : {}),
    }));
  });
}

function rowsOf(machines: readonly FleetMachineSnapshot[], seen: CloudSeen, pending: PendingCloudRow | null): CloudRow[] {
  const rows = new Map<string, CloudRow>();
  for (const row of liveRows(machines)) rows.set(cloudFolderKey(row.machine, row.session), row);
  if (pending !== null && !rows.has(cloudFolderKey(pending.machine, pending.session))) {
    rows.set(cloudFolderKey(pending.machine, pending.session), { machine: pending.machine, session: pending.session, state: 'working', repos: [], starting: true });
  }
  const liveBranches = new Set([...rows.values()].flatMap((row) => (row.branch === undefined ? [] : [row.branch])));
  for (const row of leftoverRows(machines, new Set(rows.keys()), liveBranches)) rows.set(cloudFolderKey(row.machine, row.session), row);
  const online = new Map(reporting(machines).map((machine) => [machine.agentId, machine] as const));
  for (const [key, entry] of Object.entries(seen)) {
    const reported = online.get(entry.machine);
    if (reported === undefined) continue;
    const row = rows.get(key);
    // Nothing of it is left on a machine that lists its tasks (tmux gone, no task entry, no branch to finish): it was deleted.
    if (row === undefined && reported.taskSlugs !== undefined && !reported.taskSlugs.includes(entry.session)) continue;
    if (row === undefined) {
      rows.set(key, { machine: entry.machine, session: entry.session, state: 'sleeping', repos: [], lastSeen: entry.lastSeen, ...(entry.branch ? { branch: entry.branch } : {}), ...(entry.path ? { path: entry.path } : {}) });
    } else if (row.state === 'sleeping') {
      rows.set(key, { ...row, lastSeen: entry.lastSeen });
    }
  }
  return [...rows.values()];
}

/** Where each session sits: the folder the user started it from, else the one it was last seen in, else the one named like its repository. */
function placeRows(rows: readonly CloudRow[], folders: CloudFolders, seen: CloudSeen, nodes: readonly CloudPlaceNode[]) {
  const remembered = Object.fromEntries(Object.entries(seen).flatMap(([key, entry]) => (entry.folder === undefined ? [] : [[key, entry.folder]])));
  return placeCloudRows(rows, { ...remembered, ...folders }, nodes);
}

export function cloudTreeNodes(input: {
  readonly machines: readonly FleetMachineSnapshot[];
  readonly folders: CloudFolders;
  readonly nodes: readonly CloudPlaceNode[];
  readonly seen: CloudSeen;
  readonly pending: PendingCloudRow | null;
}): ProjectTreeNode[] {
  const { machines, folders, nodes, seen, pending } = input;
  const rows = rowsOf(machines, seen, pending);
  if (rows.length === 0) return [];
  const { byFolder, loose } = placeRows(rows, folders, seen, nodes);
  const sessionNode = (row: CloudRow, parentId: string): ProjectTreeNode => {
    const id = cloudNodeId(row.machine, row.session);
    const where = [row.machine, row.branch].filter((part) => part !== undefined).join(' · ');
    return {
      id,
      parentId,
      kind: 'session',
      name: row.session,
      sessionId: id,
      // A session on a menu waits on the user, like a blocked local agent: its face asks "?".
      state: row.asking === true ? 'waiting_input' : row.state,
      request: row.starting ? `đang khởi động trên ${row.machine}` : where,
      ...(row.recentRequests === undefined ? {} : { recentRequests: [...row.recentRequests], lastRequest: row.recentRequests[0] }),
      ...(row.branch ? { branch: row.branch } : {}),
      ...(row.path ? { path: row.path } : {}),
      ...(row.state === 'sleeping' && row.lastSeen !== undefined ? { stoppedAt: new Date(row.lastSeen).toISOString() } : {}),
    };
  };
  const placed = [...byFolder].flatMap(([folder, folderRows]) => folderRows.map((row) => sessionNode(row, folder)));
  const other = loose.map((row) => sessionNode(row, CLOUD_OTHER_ID));
  return [...(other.length > 0 ? [{ id: CLOUD_OTHER_ID, kind: 'group' as const, name: CLOUD_OTHER_NAME }] : []), ...placed, ...other];
}

/**
 * The remembered sessions after this snapshot: every live session noted with its folder and the time, the ones gone
 * kept until they are a day old. The same object comes back when nothing worth writing changed.
 */
export function rememberCloud(
  seen: CloudSeen,
  machines: readonly FleetMachineSnapshot[],
  folders: CloudFolders,
  nodes: readonly CloudPlaceNode[],
  now: number,
): CloudSeen {
  // A machine that has stopped reporting repeats an old list: that is not a sighting.
  const live = liveRows(reporting(machines));
  const { byFolder } = placeRows(live, folders, seen, nodes);
  const folderOf = new Map([...byFolder].flatMap(([folder, rows]) => rows.map((row) => [cloudFolderKey(row.machine, row.session), folder] as const)));
  const next: Record<string, CloudSeenEntry> = {};
  let changed = false;
  for (const [key, entry] of Object.entries(seen)) {
    if (now - entry.lastSeen <= CLOUD_SEEN_KEEP_MS || live.some((row) => cloudFolderKey(row.machine, row.session) === key)) next[key] = entry;
    else changed = true;
  }
  for (const row of live) {
    const key = cloudFolderKey(row.machine, row.session);
    const old = next[key];
    // A session placed nowhere right now (folders not loaded yet) keeps the folder it was last seen in.
    const folder = folderOf.get(key) ?? old?.folder;
    const same = old !== undefined && old.folder === folder && old.branch === row.branch && old.path === row.path && now - old.lastSeen < CLOUD_SEEN_TOUCH_MS;
    if (same) continue;
    next[key] = {
      machine: row.machine,
      session: row.session,
      lastSeen: now,
      ...(folder === undefined ? {} : { folder }),
      ...(row.branch === undefined ? {} : { branch: row.branch }),
      ...(row.path === undefined ? {} : { path: row.path }),
    };
    changed = true;
  }
  return changed ? next : seen;
}
