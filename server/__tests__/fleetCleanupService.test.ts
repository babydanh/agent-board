import { describe, expect, it, vi } from 'vitest';

import type { GitGuardWorktree, ServerMessage } from '../../core/src/messages.js';
import { buildCleanupPlan, startCleanup } from '../src/fleet/cleanupService.js';
import type { FleetCommandService } from '../src/fleet/commandQueue.js';
import { type FleetCommandContext, handleFleetMessage } from '../src/fleet/handler.js';
import type { FleetHubClient, FleetHubMachine } from '../src/fleet/hubClient.js';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const wt = (over: Partial<GitGuardWorktree>): GitGuardWorktree => ({
  path: '/w/a', branch: 'feat/a', head: 'a'.repeat(40), unpushed: 0, unpushedSubjects: [], backedUp: false, dirty: 1, dirtyKnown: true,
  dirtyOldestMinutes: null, op: null, mergedToMain: false, idleDays: 4, idleMinutes: 4 * 1440, prunable: false, ...over,
});

function fleetOf(worktrees: GitGuardWorktree[], staged = true): FleetHubClient {
  const machine: FleetHubMachine = {
    agent_id: 'danh', received_at: Date.now(), sessions: [],
    repos: worktrees.map((w) => ({ path: w.path, branch: w.branch ?? '', ahead: 0, behind: 0, dirty_files: [], staged })),
    guard: { machine: 'danh', scannedAt: 'x', repos: [{ repo: '/data/home/shop', worktrees }], risks: [] },
  };
  return { fetchFleet: async () => ({ now: Date.now(), machines: [machine] }) };
}

/** A hub whose machine answers every command at once with `state`. */
function commandsAnswering(state: 'success' | 'failed' | 'queued' = 'success') {
  const queued: unknown[] = [];
  const service: FleetCommandService = {
    queue: async (input) => { queued.push(input); return { id: `c${queued.length}` }; },
    history: async () => queued.map((input, index) => ({ id: `c${index + 1}`, machine: 'danh', verb: (input as { verb: 'snapshot-push' }).verb, state, createdAt: 1 })),
  };
  return { service, queued };
}

describe('cleanup service', () => {
  it('plans from the cloud machines only', async () => {
    const plan = await buildCleanupPlan(fleetOf([wt({}), wt({ path: '/w/old', branch: 'feat/old', dirty: 0, mergedToMain: true })]));
    expect(plan.staging.map((i) => i.path)).toEqual(['/w/a']);
    expect(plan.junk.map((i) => i.path)).toEqual(['/w/old']);
  });

  it('runs the ticked items and reports progress for each step', async () => {
    const { service, queued } = commandsAnswering();
    const events: string[] = [];
    const summary = await startCleanup(
      { staging: [{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], junk: [{ machine: 'danh', path: '/w/old' }] },
      { fleet: fleetOf([wt({}), wt({ path: '/w/old', branch: 'feat/old', dirty: 0, mergedToMain: true })]), commands: service, sleep: async () => undefined, progress: (e) => events.push(`${e.step}:${e.status}`) },
    );
    expect(summary).toMatchObject({ ok: true, staged: 1, cleaned: 1 });
    expect(queued.map((q) => (q as { verb: string }).verb)).toEqual(['snapshot-push', 'run-tests', 'staging-sync', 'snapshot-push', 'clean-worktree']);
    expect(events).toContain('readback:ok');
  });

  it('refuses a selection the fresh plan no longer lists, and queues nothing', async () => {
    const { service, queued } = commandsAnswering();
    const summary = await startCleanup(
      { staging: [{ machine: 'danh', path: '/w/forged', branch: 'feat/forged' }], junk: [] },
      { fleet: fleetOf([wt({})]), commands: service, sleep: async () => undefined, progress: vi.fn() },
    );
    expect(summary.ok).toBe(false);
    expect(summary.refused).toMatch(/không còn trong kế hoạch/);
    expect(queued).toEqual([]);
  });

  it('a command that never ends is given up on after the wait limit, and its step fails', async () => {
    const { service } = commandsAnswering('queued');
    let clock = 0;
    const events: { step: string; status: string; detail?: string }[] = [];
    const summary = await startCleanup(
      { staging: [{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], junk: [] },
      { fleet: fleetOf([wt({})]), commands: service, now: () => clock, sleep: async (ms) => { clock += ms * 100; }, progress: (e) => events.push(e) },
    );
    expect(summary.ok).toBe(false);
    expect(events.find((e) => e.status === 'failed')).toMatchObject({ step: 'backup', detail: expect.stringContaining('chưa trả lời') });
  });

  it('only one run at a time: a second start while one waits is refused', async () => {
    const { service } = commandsAnswering('queued');
    let clock = 0;
    const first = startCleanup(
      { staging: [{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], junk: [] },
      { fleet: fleetOf([wt({})]), commands: service, now: () => clock, sleep: async (ms) => { clock += ms * 100; }, progress: vi.fn() },
    );
    const second = await startCleanup({ staging: [], junk: [] }, { fleet: fleetOf([]), commands: service, progress: vi.fn() });
    expect(second.refused).toMatch(/lượt dọn khác/);
    await first;
    expect((await startCleanup({ staging: [], junk: [] }, { fleet: fleetOf([]), commands: service, progress: vi.fn() })).ok).toBe(true);
  });
});

describe('cleanup messages', () => {
  const planRequest = { type: 'fleetCleanupPlanRequest', requestId: REQUEST_ID };
  const start = { type: 'fleetCleanupStart', requestId: REQUEST_ID, staging: [{ machine: 'danh', path: '/w/a', branch: 'feat/a' }], junk: [] };
  const run = (msg: Record<string, unknown>, context: Partial<FleetCommandContext>) => {
    const sent: ServerMessage[] = [];
    const handled = handleFleetMessage(msg, (m) => sent.push(m), { ledger: null, privileged: true, ...context });
    return { handled, sent };
  };

  it('an unprivileged socket may neither read the plan nor start a cleanup', () => {
    const queue = vi.fn();
    for (const msg of [planRequest, start]) {
      const { sent } = run(msg, { privileged: false, fleet: fleetOf([wt({})]), commands: { queue, history: async () => [] } });
      expect(sent).toEqual([expect.objectContaining({ type: 'fleetCommandResult', ok: false, code: 'forbidden' })]);
    }
    expect(queue).not.toHaveBeenCalled();
  });

  it('answers a plan request with the three lists', async () => {
    const { sent } = run(planRequest, { fleet: fleetOf([wt({})]) });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: 'fleetCleanupPlan', requestId: REQUEST_ID, staging: [expect.objectContaining({ path: '/w/a' })], junk: [], kept: [] });
  });

  it('streams progress and ends with a done message', async () => {
    const { service } = commandsAnswering();
    const { sent } = run(start, { fleet: fleetOf([wt({})]), commands: service });
    await vi.waitFor(() => expect(sent.at(-1)).toMatchObject({ type: 'fleetCleanupDone' }));
    expect(sent.some((m) => m.type === 'fleetCleanupProgress' && m.step === 'tests' && m.status === 'ok')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ requestId: REQUEST_ID, ok: true, staged: 1 });
  });

  it('rejects a malformed start before anything is read', () => {
    const queue = vi.fn();
    for (const bad of [
      { ...start, staging: [{ machine: 'danh', path: '/w/a', branch: 'a b' }] },
      { ...start, staging: 'x' },
      { ...start, junk: [{ machine: 'Danh!', path: '/w' }] },
    ]) {
      const { sent } = run(bad, { fleet: fleetOf([wt({})]), commands: { queue, history: async () => [] } });
      expect(sent).toEqual([expect.objectContaining({ type: 'fleetCommandResult', ok: false, code: 'failed' })]);
    }
    expect(queue).not.toHaveBeenCalled();
  });
});
