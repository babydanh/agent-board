import type { FleetMachineSnapshot } from '../../../../core/src/messages.js';
import { type CloudPlaceNode, folderRepoNames } from './cloudFolders.js';

/** The three project repositories a machine must have cloned to take an all-repo task. */
export const PROJECT_REPOS = ['HethongBackendApi_QuanlyGiaiDau', 'HethongFrontEndWeb_QLgiaidau', 'HethongFrontEndApp_QLgiaidau'];
/** Agents per machine the board hands out (measured: 2 Claude + 1 omp used 3.4 of 8 GB). */
export const MAX_SESSIONS_PER_MACHINE = 3;

/** Repositories a task of each kind needs on the machine. */
const REPOS_FOR_TASK = {
  all: PROJECT_REPOS,
  backend: [PROJECT_REPOS[0]!],
  web: [PROJECT_REPOS[1]!],
  app: [PROJECT_REPOS[2]!],
} as const;
export type TaskRepoKind = keyof typeof REPOS_FOR_TASK;

/** Below this much free disk a machine takes a new task only when no other machine can. */
export const MIN_FREE_DISK_GB = 3;
/** A session untouched this long counts as parked, not as load. */
const ACTIVE_IDLE_SECONDS = 600;

export interface MachinePick {
  readonly machine: string;
  readonly sessions: number;
  /** Sessions someone touched recently: what actually loads the machine. */
  readonly active: number;
  readonly diskFreeGb: number | undefined;
  readonly stale: boolean;
}

/**
 * Machines that have the repositories a task needs (all three by default), best first: fresh report before
 * stale, enough disk before short, then fewest working sessions, fewest sessions in all, most free disk, name.
 */
export function projectMachines(machines: readonly FleetMachineSnapshot[], repo: TaskRepoKind = 'all'): MachinePick[] {
  const lowDisk = (pick: MachinePick): boolean => pick.diskFreeGb !== undefined && pick.diskFreeGb < MIN_FREE_DISK_GB;
  return machines
    .filter((machine) => REPOS_FOR_TASK[repo].every((name) => machine.repos.some((have) => have.name === name)))
    .map((machine) => {
      const sessions = machine.tmuxSessions ?? [];
      return {
        machine: machine.agentId,
        sessions: sessions.length,
        active: sessions.filter((session) => session.idleSeconds < ACTIVE_IDLE_SECONDS).length,
        diskFreeGb: machine.diskFreeGb,
        stale: machine.state !== 'online',
      };
    })
    .sort(
      (a, b) =>
        Number(a.stale) - Number(b.stale) ||
        Number(lowDisk(a)) - Number(lowDisk(b)) ||
        a.active - b.active ||
        a.sessions - b.sessions ||
        (b.diskFreeGb ?? 0) - (a.diskFreeGb ?? 0) ||
        a.machine.localeCompare(b.machine),
    );
}

/** The machine a new task goes to: the best one below the session cap, or null when all are full. */
export function pickMachine(machines: readonly FleetMachineSnapshot[], repo: TaskRepoKind = 'all'): string | null {
  return projectMachines(machines, repo).find((pick) => pick.sessions < MAX_SESSIONS_PER_MACHINE)?.machine ?? null;
}

/** Whether some machine has a repository this node's folders are named after; a node with no folder is not judged. */
export function cloudHasRepo(nodeId: string, nodes: readonly CloudPlaceNode[], machines: readonly FleetMachineSnapshot[]): boolean {
  const wanted = folderRepoNames(nodes, nodeId);
  if (wanted.size === 0) return true;
  return machines.some((machine) => machine.repos.some((repo) => wanted.has(repo.name.toLowerCase())));
}

/**
 * A task name from the request: its first words without accents ("Sửa xếp sân đôi" -> "sua-xep-san-doi"),
 * plus a short suffix so two similar requests never share a tmux session or branch.
 */
export function slugFromPrompt(prompt: string, suffix: string): string {
  const words = prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5);
  const base = words.join('-').slice(0, 30).replace(/-+$/, '');
  return `${base || 'viec'}-${suffix}`.replace(/^-+/, '');
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}
