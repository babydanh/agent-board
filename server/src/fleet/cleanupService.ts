import type { FleetCleanupStartMessage } from '../../../core/src/messages.js';
import { type CleanupItem, type CleanupPlan, planCleanup } from './cleanupPlan.js';
import { type CleanupDeps, type CleanupEvent, type CleanupOutcome, type CleanupSummary,runCleanup } from './cleanupRunner.js';
import type { FleetCommandService } from './commandQueue.js';
import { FLEET_CLEANUP_SETTLE_POLL_MS, FLEET_CLEANUP_SETTLE_TIMEOUT_MS } from './constants.js';
import { computeFleetOverlaps, splitLocalReporters } from './fleetSnapshot.js';
import type { FleetHubClient } from './hubClient.js';

export interface CleanupServiceDeps {
  readonly fleet: FleetHubClient;
  readonly commands: FleetCommandService;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly progress: (event: CleanupEvent) => void;
}

const TERMINAL = new Set(['success', 'failed', 'refused', 'expired']);
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// One run per board process: a double click or a second window must not queue every command twice.
let running = false;

export async function buildCleanupPlan(fleet: FleetHubClient): Promise<CleanupPlan> {
  const { cloud } = splitLocalReporters(await fleet.fetchFleet());
  return planCleanup(cloud.machines);
}

/** Resolves the ticked items against a fresh plan. Returns the reason when any of them is no longer in it. */
function resolveSelection(selection: Pick<FleetCleanupStartMessage, 'staging' | 'junk'>, plan: CleanupPlan): { staging: CleanupItem[]; junk: CleanupItem[] } | string {
  const staging: CleanupItem[] = [];
  const junk: CleanupItem[] = [];
  for (const wanted of selection.staging) {
    const found = plan.staging.find((item) => item.machine === wanted.machine && item.path === wanted.path && item.branch === wanted.branch);
    if (!found) return `Nhánh ${wanted.branch} không còn trong kế hoạch, hãy tải lại kế hoạch.`;
    staging.push(found);
  }
  for (const wanted of selection.junk) {
    const found = plan.junk.find((item) => item.machine === wanted.machine && item.path === wanted.path);
    if (!found) return `Thư mục ${wanted.path} không còn là rác, hãy tải lại kế hoạch.`;
    junk.push(found);
  }
  return { staging, junk };
}

export async function startCleanup(selection: Pick<FleetCleanupStartMessage, 'staging' | 'junk'>, deps: CleanupServiceDeps): Promise<CleanupSummary> {
  const refused = (reason: string): CleanupSummary => ({ ok: false, staged: 0, cleaned: 0, failed: 0, skipped: 0, blocked: [], refused: reason });
  if (running) return refused('Đang có một lượt dọn khác chạy.');
  running = true;
  try {
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? defaultSleep;
    const response = await deps.fleet.fetchFleet();
    const { cloud } = splitLocalReporters(response);
    const resolved = resolveSelection(selection, planCleanup(cloud.machines));
    if (typeof resolved === 'string') return refused(resolved);

    const settle = async (id: string): Promise<CleanupOutcome> => {
      const deadline = now() + FLEET_CLEANUP_SETTLE_TIMEOUT_MS;
      for (;;) {
        const row = (await deps.commands.history()).find((candidate) => candidate.id === id);
        if (row !== undefined && TERMINAL.has(row.state)) return { state: row.state, ...(row.detail === undefined ? {} : { detail: row.detail }) };
        if (now() >= deadline) return { state: 'expired', detail: 'Máy chưa trả lời lệnh trong thời gian chờ.' };
        await sleep(FLEET_CLEANUP_SETTLE_POLL_MS);
      }
    };
    const isStaged = async (item: CleanupItem): Promise<boolean> => {
      const machine = (await deps.fleet.fetchFleet()).machines.find((candidate) => candidate.agent_id === item.machine);
      return machine?.repos.some((repo) => repo.path === item.path && repo.staged === true) ?? false;
    };
    const runDeps: CleanupDeps = {
      queue: (input) => deps.commands.queue(input),
      settle,
      isStaged,
      sleep,
      progress: deps.progress,
      overlaps: computeFleetOverlaps(cloud.machines, [], now()),
    };
    return await runCleanup(resolved, runDeps);
  } finally {
    running = false;
  }
}
