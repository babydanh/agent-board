import { type BlockingPair, blockingPairs, type BlockOverlap } from '../../../core/src/cleanupBlock.js';
import type { CleanupItem } from './cleanupPlan.js';
import type { FleetCommandInput } from './commandQueue.js';
import { FLEET_CLEANUP_READBACK_GAP_MS, FLEET_CLEANUP_READBACK_TRIES, FLEET_PROTECTED_BRANCHES } from './constants.js';

export type CleanupStep = 'backup' | 'tests' | 'staging' | 'readback' | 'clean';

export interface CleanupEvent {
  readonly step: CleanupStep;
  readonly machine: string;
  readonly path: string;
  readonly branch: string | null;
  readonly status: 'running' | 'ok' | 'failed' | 'skipped';
  readonly detail?: string;
}

export interface CleanupOutcome {
  readonly state: 'queued' | 'delivered' | 'success' | 'failed' | 'refused' | 'expired';
  readonly detail?: string;
}

export interface CleanupDeps {
  /** Queues one fixed command for the machine that owns the checkout (the hub and the machine validate it again). */
  queue(input: FleetCommandInput): Promise<{ readonly id: string }>;
  /** Resolves when the command ended (success, failed, refused or expired). */
  settle(id: string): Promise<CleanupOutcome>;
  /** One read of the hub: does it report this item's branch as contained in origin/staging? */
  isStaged(item: CleanupItem): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  progress(event: CleanupEvent): void;
  /** The overlap warnings the board shows, to refuse a ticked pair git cannot merge. */
  readonly overlaps: BlockOverlap[];
}

export interface CleanupSelection {
  readonly staging: readonly CleanupItem[];
  readonly junk: readonly CleanupItem[];
}

export interface CleanupSummary {
  readonly ok: boolean;
  readonly staged: number;
  readonly cleaned: number;
  readonly failed: number;
  readonly skipped: number;
  readonly blocked: BlockingPair<CleanupItem>[];
  /** Set when nothing was queued because the selection itself is not allowed. */
  readonly refused?: string;
}

const LOCAL_REPORTER_PREFIX = 'local-';

const bareBranch = (branch: string): string => branch.replace(/^refs\/heads\//, '').replace(/^(refs\/remotes\/)?origin\//, '').toLowerCase();

/** Why this selection must not run at all, or null. Nothing is queued when this answers. */
function selectionError(selection: CleanupSelection): string | null {
  for (const item of [...selection.staging, ...selection.junk]) {
    if (item.machine.startsWith(LOCAL_REPORTER_PREFIX)) return `Máy ${item.machine} không nhận lệnh dọn qua hub.`;
  }
  for (const item of selection.staging) {
    if (item.branch === null) return `Nhánh của ${item.path} không xác định.`;
    if (FLEET_PROTECTED_BRANCHES.includes(bareBranch(item.branch))) return `Nhánh ${item.branch} được bảo vệ, không đưa qua đây.`;
  }
  return null;
}

export async function runCleanup(selection: CleanupSelection, deps: CleanupDeps): Promise<CleanupSummary> {
  const tally = { staged: 0, cleaned: 0, failed: 0, skipped: 0 };
  const done = (extra: Partial<CleanupSummary> = {}): CleanupSummary => ({ ok: tally.failed === 0 && extra.refused === undefined, blocked: [], ...tally, ...extra });
  const refused = selectionError(selection);
  if (refused !== null) return done({ refused });
  const blocked = blockingPairs(selection.staging, deps.overlaps);
  if (blocked.length > 0) {
    const names = blocked.map((pair) => `${pair.a.branch} ↔ ${pair.b.branch}`).join('; ');
    return done({ refused: `Các nhánh này chưa gộp được với nhau: ${names}`, blocked });
  }

  const emit = (step: CleanupStep, item: CleanupItem, status: CleanupEvent['status'], detail?: string): void => {
    deps.progress({ step, machine: item.machine, path: item.path, branch: item.branch, status, ...(detail === undefined ? {} : { detail }) });
    if (status === 'failed') tally.failed += 1;
    if (status === 'skipped') tally.skipped += 1;
  };
  const command = async (step: CleanupStep, item: CleanupItem, input: FleetCommandInput): Promise<CleanupOutcome> => {
    emit(step, item, 'running');
    let outcome: CleanupOutcome;
    try {
      outcome = await deps.settle((await deps.queue(input)).id);
    } catch (error) {
      outcome = { state: 'failed', detail: error instanceof Error ? error.message : String(error) };
    }
    return outcome;
  };
  const fail = (step: CleanupStep, item: CleanupItem, outcome: CleanupOutcome): false => {
    emit(step, item, outcome.state === 'refused' && step === 'clean' ? 'skipped' : 'failed', outcome.detail ?? outcome.state);
    return false;
  };

  const stageOne = async (item: CleanupItem): Promise<boolean> => {
    const { machine, path } = item;
    const branch = item.branch as string;
    const backup = await command('backup', item, { machine, verb: 'snapshot-push', path });
    if (backup.state !== 'success') return fail('backup', item, backup);
    emit('backup', item, 'ok', backup.detail);
    const tests = await command('tests', item, { machine, verb: 'run-tests', branch });
    if (tests.state !== 'success') return fail('tests', item, tests);
    emit('tests', item, 'ok', tests.detail);
    const sync = await command('staging', item, { machine, verb: 'staging-sync', branch });
    if (sync.state !== 'success') return fail('staging', item, sync);
    emit('staging', item, 'ok', sync.detail);
    emit('readback', item, 'running');
    for (let attempt = 0; attempt < FLEET_CLEANUP_READBACK_TRIES; attempt += 1) {
      if (await deps.isStaged(item).catch(() => false)) { emit('readback', item, 'ok'); tally.staged += 1; return true; }
      await deps.sleep(FLEET_CLEANUP_READBACK_GAP_MS);
    }
    return fail('readback', item, { state: 'failed', detail: `${branch}: chưa thấy trên staging, không dọn gì thêm` });
  };

  const cleanOne = async (item: CleanupItem): Promise<void> => {
    const backup = await command('backup', item, { machine: item.machine, verb: 'snapshot-push', path: item.path });
    if (backup.state !== 'success') { fail('backup', item, backup); return; }
    emit('backup', item, 'ok', backup.detail);
    const input: FleetCommandInput = { machine: item.machine, verb: 'clean-worktree', path: item.path, ...(item.branch === null ? {} : { branch: item.branch }) };
    const removed = await command('clean', item, input);
    if (removed.state !== 'success') { fail('clean', item, removed); return; }
    emit('clean', item, 'ok', removed.detail);
    tally.cleaned += 1;
  };

  // One branch at a time, the smallest first; the first failure stops every later branch and the whole cleanup.
  const order = [...selection.staging].sort((a, b) => a.dirty + a.unpushed - (b.dirty + b.unpushed) || a.path.localeCompare(b.path));
  let halted: string | null = null;
  for (const item of order) {
    if (halted !== null) { emit('staging', item, 'skipped', halted); continue; }
    if (!(await stageOne(item))) halted = `Dừng vì ${item.branch} chưa lên staging`;
  }
  for (const item of selection.junk) {
    if (halted !== null) emit('clean', item, 'skipped', halted);
    else await cleanOne(item);
  }
  return done();
}
