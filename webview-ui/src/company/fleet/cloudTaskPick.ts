import type { FleetMachineSnapshot } from '../../../../core/src/messages.js';
import { type CloudPlaceNode, folderRepoNames } from './cloudFolders.js';

/** The three project repositories a machine must have cloned to take an all-repo task. */
export const PROJECT_REPOS = ['HethongBackendApi_QuanlyGiaiDau', 'HethongFrontEndWeb_QLgiaidau', 'HethongFrontEndApp_QLgiaidau'];
/** Agents per machine the board hands out (measured: 2 Claude + 1 omp used 3.4 of 8 GB). */
export const MAX_SESSIONS_PER_MACHINE = 3;

export interface MachinePick {
  readonly machine: string;
  readonly sessions: number;
}

/** Machines that have all project repositories, with how many agents each runs; fewest first, then by name. */
export function projectMachines(machines: readonly FleetMachineSnapshot[]): MachinePick[] {
  return machines
    .filter((machine) => PROJECT_REPOS.every((name) => machine.repos.some((repo) => repo.name === name)))
    .map((machine) => ({ machine: machine.agentId, sessions: (machine.tmuxSessions ?? []).length }))
    .sort((a, b) => a.sessions - b.sessions || a.machine.localeCompare(b.machine));
}

/** The machine a new task goes to: the least busy project machine below the cap, or null when all are full. */
export function pickMachine(machines: readonly FleetMachineSnapshot[]): string | null {
  return projectMachines(machines).find((pick) => pick.sessions < MAX_SESSIONS_PER_MACHINE)?.machine ?? null;
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
