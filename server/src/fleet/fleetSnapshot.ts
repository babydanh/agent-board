import { agentEngineForCommand, agentEngineForKind } from '../../../core/src/agentEngines.js';
import type {
  FleetMachineSnapshot,
  FleetOverlapWarning,
  FleetSnapshotMessage,
  GitGuardReport,
  LedgerView,
} from '../../../core/src/messages.js';
import { FLEET_HUB_TASK_LIMIT, FLEET_LAVISH_KEY, FLEET_SESSION_NAME, FLEET_STALE_AFTER_MS, FLEET_TASK_SLUG } from './constants.js';
import type { FleetHubMachine, FleetHubRepo, FleetHubResponse } from './hubClient.js';

export type FleetMachineState = FleetMachineSnapshot['state'];

export interface FleetLocalRepo {
  readonly repo: string;
  readonly dirtyFiles: readonly string[];
}

/** A machine named `local-…` is one of the user's own computers (fleet/local-agent.mjs), not a cloud machine. */
export const LOCAL_REPORTER_PREFIX = 'local-';

/**
 * Splits the hub's answer: local reporters count for file overlaps only. They must not become machine cards, get
 * branch analysis or exec, show in the sleepers popup, or be picked to host a cloud task.
 */
export function splitLocalReporters(response: FleetHubResponse): { cloud: FleetHubResponse; reporters: FleetHubMachine[] } {
  const isReporter = (machine: FleetHubMachine): boolean => machine.agent_id.startsWith(LOCAL_REPORTER_PREFIX);
  return {
    cloud: { ...response, machines: response.machines.filter((machine) => !isReporter(machine)) },
    reporters: response.machines.filter(isReporter),
  };
}

export function classifyFleetMachineState(receivedAt: number, nowMs: number): FleetMachineState {
  return nowMs - receivedAt > FLEET_STALE_AFTER_MS ? 'stale' : 'online';
}

type Ranges = readonly (readonly [number, number])[];
interface Touch {
  readonly machine: string;
  /** Null when only the file is known (uncommitted new file, or an agent without line data). */
  readonly ranges: Ranges | null;
}

function rangesIntersect(a: Ranges, b: Ranges): boolean {
  return a.some(([s1, e1]) => b.some(([s2, e2]) => s1 <= e2 && s2 <= e1));
}

function formatRanges(ranges: Ranges): string {
  return ranges.map(([s, e]) => (s === e ? `${s}` : `${s}–${e}`)).join(', ');
}

export function computeFleetOverlaps(
  machines: readonly FleetHubMachine[],
  localRepos: readonly FleetLocalRepo[],
): FleetOverlapWarning[] {
  const entries = new Map<string, { repo: string; path: string; touches: Map<string, Touch>; local: boolean }>();
  const touch = (repoName: string, file: string, machine: string, ranges: Ranges | null) => {
    const path = normalizeRelativePath(file);
    if (path === '') return;
    const key = overlapKey(repoName, path);
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = { repo: repoName, path, touches: new Map(), local: false };
      entries.set(key, entry);
    }
    const previous = entry.touches.get(machine);
    // Line data wins over a bare file mention; two line lists for one machine are merged.
    const merged = previous === undefined ? ranges
      : previous.ranges === null ? ranges
      : ranges === null ? previous.ranges
      : [...previous.ranges, ...ranges];
    entry.touches.set(machine, { machine, ranges: merged });
  };

  for (const machine of machines) {
    for (const repo of machine.repos) {
      const repoName = hubRepoName(repo);
      if (repoName === '') continue;
      for (const change of repo.changes ?? []) touch(repoName, change.path, machine.agent_id, change.ranges);
      for (const file of repo.dirty_files) touch(repoName, file, machine.agent_id, null);
    }
  }

  for (const repo of localRepos) {
    const repoName = repositoryName(repo.repo);
    if (repoName === '') continue;
    for (const file of repo.dirtyFiles) {
      const entry = entries.get(overlapKey(repoName, normalizeRelativePath(file)));
      if (entry !== undefined) entry.local = true;
    }
  }

  const warnings: FleetOverlapWarning[] = [];
  for (const entry of entries.values()) {
    const touches = [...entry.touches.values()];
    const clashing = new Set<string>();
    let lineLevel = true;
    for (let i = 0; i < touches.length; i++) {
      for (let j = i + 1; j < touches.length; j++) {
        const a = touches[i], b = touches[j];
        if (a.ranges !== null && b.ranges !== null && !rangesIntersect(a.ranges, b.ranges)) continue;
        if (a.ranges === null || b.ranges === null) lineLevel = false;
        clashing.add(a.machine).add(b.machine);
      }
    }
    // The local machine only reports file names, so a local clash is file-level.
    const withLocal = entry.local && touches.length > 0;
    if (clashing.size === 0 && !withLocal) continue;
    const involved = clashing.size > 0 ? touches.filter((t) => clashing.has(t.machine)) : touches;
    warnings.push({
      repo: entry.repo,
      path: entry.path,
      machines: involved.map((t) => t.machine).sort(),
      local: entry.local,
      level: clashing.size > 0 && lineLevel ? 'line' : 'file',
      detail: involved
        .filter((t) => t.ranges !== null)
        .map((t) => `${t.machine}: dòng ${formatRanges(t.ranges as Ranges)}`)
        .join(' · '),
    });
  }
  return warnings.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path));
}

export function buildFleetSnapshot(
  requestId: string,
  response: FleetHubResponse,
  localView: LedgerView | null,
  localGuard: GitGuardReport | null = null,
  expectedSkillVersion: string | null = null,
  reporters: readonly FleetHubMachine[] = [],
): FleetSnapshotMessage {
  const localActiveSessions = localView?.sessions.filter((session) => session.open) ?? [];
  const localActiveBranches = [
    ...new Set(
      localActiveSessions
        .map((session) => session.branch)
        .filter((branch): branch is string => Boolean(branch)),
    ),
  ];
  const localActivePaths = localActiveSessions.map((session) => session.cwd).filter(Boolean);
  const localRepos =
    localView?.repos.flatMap((repo) =>
      repo.worktrees.map((worktree) => ({
        repo: repo.repo,
        dirtyFiles: worktree.dirtyFiles.map((file) => file.path),
      })),
    ) ?? [];

  return {
    type: 'fleetSnapshot',
    requestId,
    machines: response.machines.map((machine): FleetMachineSnapshot => {
      const activeTasks = machine.viec?.filter((task) => task.status === 'dang-lam') ?? [];
      const activeBranches = [
        ...new Set(
          [
            ...machine.sessions.map((session) => session.branch),
            ...(machine.tmux ?? []).map((session) => session.branch ?? ''),
            ...activeTasks.map((task) => task.branch),
          ].filter(Boolean),
        ),
      ];
      const activePaths = [
        ...machine.sessions.map((session) => session.cwd),
        ...(machine.tmux ?? []).map((session) => session.cwd ?? ''),
      ].filter(Boolean);
      const activeTaskSlugs = activeTasks.map((task) => task.slug);
      return {
        agentId: machine.agent_id,
        receivedAt: machine.received_at,
        state: classifyFleetMachineState(machine.received_at, response.now),
        sessionCount: machine.sessions.length,
        engines: [...new Set(machine.sessions.map((session) => session.engine))].sort(),
        repos: machine.repos.map((repo) => ({
          path: repo.path,
          name: hubRepoName(repo),
          branch: repo.branch,
          ahead: repo.ahead,
          behind: repo.behind,
          dirtyCount: repo.dirty_files.length,
          ...(typeof repo.merged === 'boolean' ? { merged: repo.merged } : {}),
          ...(typeof repo.staged === 'boolean' ? { staged: repo.staged } : {}),
        })),
        ...(typeof machine.disk_free_gb === 'number' ? { diskFreeGb: machine.disk_free_gb } : {}),
        ...(machine.skill_version ? { skillVersion: machine.skill_version } : {}),
        // Stale = differs from the last bundle dong-bo-cloud.ps1 pushed. A machine that reports none is not judged:
        // its agent or the hub may be older than this field, which would flag every machine at once.
        ...(expectedSkillVersion && machine.skill_version ? { skillStale: machine.skill_version !== expectedSkillVersion } : {}),
        // Every task the machine remembers, finished too. A list the hub cut short says nothing about the rest: left out.
        ...(machine.viec && machine.viec.length < FLEET_HUB_TASK_LIMIT
          ? { taskSlugs: machine.viec.map((task) => task.slug).filter((slug) => FLEET_TASK_SLUG.test(slug)) }
          : {}),
        lavishSessions: (machine.lavish ?? [])
          .filter(
            (session) =>
              typeof session.key === 'string' &&
              FLEET_LAVISH_KEY.test(session.key) &&
              typeof session.file === 'string',
          )
          .map((session) => ({ key: session.key, file: session.file })),
        tmuxSessions: (machine.tmux ?? [])
          .filter(
            (session) => typeof session.name === 'string' && FLEET_SESSION_NAME.test(session.name),
          )
          .map((session) => {
            const engine = agentEngineForKind(session.engine) ?? agentEngineForCommand(session.command);
            return {
              name: session.name,
              attached: session.attached === true,
              idleSeconds: Number.isFinite(session.idle_seconds)
                ? Math.max(0, Math.floor(session.idle_seconds))
                : 0,
              ...(engine === null ? {} : { engine }),
              ...(typeof session.command === 'string' && session.command
                ? { command: session.command }
                : {}),
              ...(typeof session.branch === 'string' && session.branch
                ? { branch: session.branch }
                : {}),
              ...(typeof session.cwd === 'string' && session.cwd
                ? { cwd: session.cwd }
                : {}),
            };
          }),
        ...(machine.guard ? { guard: machine.guard } : {}),
        ...(activeBranches.length ? { activeBranches } : {}),
        ...(activePaths.length ? { activePaths } : {}),
        ...(activeTaskSlugs.length ? { activeTaskSlugs } : {}),
      };
    }),
    overlaps: computeFleetOverlaps([...response.machines, ...reporters], localRepos),
    ...(localGuard ? { localGuard } : {}),
    ...(localActiveBranches.length ? { localActiveBranches } : {}),
    ...(localActivePaths.length ? { localActivePaths } : {}),
  };
}

function hubRepoName(repo: FleetHubRepo): string {
  return typeof repo.repo === 'string' && repo.repo !== '' ? repo.repo : repositoryName(repo.path);
}

function repositoryName(path: string): string {
  const parts = path.trim().replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  const parent = parts.at(-2);
  if (parent?.toLowerCase() === '.worktrees' && parts.length >= 3) return parts.at(-3) ?? '';
  if (parent?.toLowerCase().endsWith('.worktrees')) return parent.slice(0, -'.worktrees'.length);
  const name = parts.at(-1) ?? '';
  return name.toLowerCase().endsWith('.worktrees') ? name.slice(0, -'.worktrees'.length) : name;
}

function normalizeRelativePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '');
}

function overlapKey(repo: string, file: string): string {
  return `${repo.toLowerCase()}\u0000${file.toLowerCase()}`;
}
