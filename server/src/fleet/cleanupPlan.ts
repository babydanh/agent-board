import type { GitGuardWorktree } from '../../../core/src/messages.js';
import { FLEET_PROTECTED_BRANCHES } from './constants.js';
import type { FleetHubMachine } from './hubClient.js';

/** One checkout the cleanup dialog may list. `machine` is the only machine a command for it may be queued to. */
export interface CleanupItem {
  readonly machine: string;
  readonly repo: string;
  readonly path: string;
  readonly branch: string | null;
  readonly dirty: number;
  readonly unpushed: number;
  readonly backedUp: boolean;
  readonly prunable: boolean;
  readonly idleDays: number;
  /** Why the checkout is in its list (Vietnamese, shown next to the tick box). */
  readonly reason: string;
}

export interface CleanupPlan {
  /** Real work: a branch that can go to staging. Nothing here is removed. */
  readonly staging: CleanupItem[];
  /** Safe to remove after a backup: merged, empty or its folder is gone, and nobody is using it. */
  readonly junk: CleanupItem[];
  /** Left alone with the reason: in use, mid-operation, state unknown, detached or on a protected branch. */
  readonly kept: CleanupItem[];
}

const RECENT_MINUTES = 24 * 60;
const LOCAL_REPORTER_PREFIX = 'local-';

const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const isProtected = (branch: string): boolean =>
  FLEET_PROTECTED_BRANCHES.includes(branch.replace(/^refs\/heads\//, '').replace(/^(refs\/remotes\/)?origin\//, '').toLowerCase());

/** True when a live session (Claude/omp process or tmux pane) works in the checkout or below it. */
function inUse(path: string, machine: FleetHubMachine): boolean {
  const root = normalize(path);
  const cwds = [...machine.sessions.map((session) => session.cwd), ...(machine.tmux ?? []).map((pane) => pane.cwd)];
  return cwds.some((cwd) => {
    if (typeof cwd !== 'string' || cwd === '') return false;
    const at = normalize(cwd);
    return at === root || at.startsWith(`${root}/`);
  });
}

const idleMinutesOf = (worktree: GitGuardWorktree): number => worktree.idleMinutes ?? worktree.idleDays * 24 * 60;

/**
 * Sorts every reported checkout into staging / junk / kept (design decisions 11 and 12). Anything unclear is kept, never junk.
 * Only a machine's own guard report plans that machine's checkouts: a row whose guard names another machine is ignored.
 */
export function planCleanup(machines: readonly FleetHubMachine[]): CleanupPlan {
  const plan: { staging: CleanupItem[]; junk: CleanupItem[]; kept: CleanupItem[] } = { staging: [], junk: [], kept: [] };
  for (const machine of machines) {
    const guard = machine.guard;
    if (guard === null || guard === undefined) continue;
    if (machine.agent_id.startsWith(LOCAL_REPORTER_PREFIX) || guard.machine !== machine.agent_id) continue;
    for (const repo of guard.repos) {
      for (const worktree of repo.worktrees) {
        if (normalize(worktree.path) === normalize(repo.repo)) continue; // the main checkout is never offered
        const item = (reason: string): CleanupItem => ({
          machine: machine.agent_id,
          repo: repo.repo,
          path: worktree.path,
          branch: worktree.branch,
          dirty: worktree.dirty,
          unpushed: worktree.unpushed,
          backedUp: worktree.backedUp,
          prunable: worktree.prunable,
          idleDays: worktree.idleDays,
          reason,
        });
        if (worktree.prunable) { plan.junk.push(item('Thư mục đã mất, chỉ còn bản ghi git')); continue; }
        if (worktree.op !== null) { plan.kept.push(item(`Đang ${worktree.op} dở`)); continue; }
        if (worktree.dirtyKnown === false) { plan.kept.push(item('Chưa đọc được trạng thái, giữ lại')); continue; }
        if (worktree.branch === null) { plan.kept.push(item('HEAD tách rời (không có nhánh), giữ lại')); continue; }
        if (isProtected(worktree.branch)) { plan.kept.push(item(`Nhánh ${worktree.branch} được bảo vệ`)); continue; }
        const clean = worktree.dirty === 0 && worktree.unpushed === 0;
        if (clean && worktree.mergedToMain) {
          if (inUse(worktree.path, machine)) { plan.kept.push(item('Đang có phiên làm việc')); continue; }
          if (idleMinutesOf(worktree) < RECENT_MINUTES) { plan.kept.push(item('Vừa thay đổi trong 24 giờ qua')); continue; }
          plan.junk.push(item('Đã gộp vào nhánh chính, không còn gì dở'));
          continue;
        }
        plan.staging.push(item(worktree.dirty > 0 ? `${worktree.dirty} tệp chưa commit` : worktree.unpushed > 0 ? `${worktree.unpushed} commit chưa đẩy` : 'Nhánh chưa gộp vào nhánh chính'));
      }
    }
  }
  return plan;
}
