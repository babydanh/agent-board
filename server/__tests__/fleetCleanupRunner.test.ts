import { describe, expect, it } from 'vitest';

import type { CleanupItem } from '../src/fleet/cleanupPlan.js';
import { type CleanupDeps, type CleanupEvent, runCleanup } from '../src/fleet/cleanupRunner.js';
import type { FleetCommandInput } from '../src/fleet/commandQueue.js';

const item = (over: Partial<CleanupItem> = {}): CleanupItem => ({
  machine: 'danh', repo: '/data/home/shop', path: '/w/a', branch: 'feat/a', dirty: 1, unpushed: 0, backedUp: false, prunable: false, idleDays: 3, reason: 'x', ...over,
});

type Outcome = { state: 'success' | 'failed' | 'refused' | 'expired'; detail?: string };

/** A scripted board: records every queued command and answers each from `answer` (default success). */
function harness(answer: (input: FleetCommandInput) => Outcome = () => ({ state: 'success' }), staged: (item: CleanupItem, call: number) => boolean = () => true) {
  const queued: FleetCommandInput[] = [];
  const events: CleanupEvent[] = [];
  const outcomes = new Map<string, Outcome>();
  let stagedCalls = 0;
  const deps: CleanupDeps = {
    queue: async (input) => {
      queued.push(input);
      const id = `c${queued.length}`;
      outcomes.set(id, answer(input));
      return { id };
    },
    settle: async (id) => outcomes.get(id) ?? { state: 'expired' },
    isStaged: async (target) => staged(target, ++stagedCalls),
    sleep: async () => undefined,
    progress: (event) => events.push(event),
    overlaps: [],
  };
  return { deps, queued, events };
}

const verbs = (queued: FleetCommandInput[]) => queued.map((q) => q.verb);

describe('runCleanup', () => {
  it('TC-CLEAN-RUN-01: nothing ticked queues nothing', async () => {
    const { deps, queued } = harness();
    const summary = await runCleanup({ staging: [], junk: [] }, deps);
    expect(queued).toEqual([]);
    expect(summary).toMatchObject({ ok: true, staged: 0, cleaned: 0 });
  });

  it('runs backup, tests, staging and a read-back for a branch, then backs up and removes junk', async () => {
    const { deps, queued, events } = harness();
    const summary = await runCleanup({ staging: [item()], junk: [item({ path: '/w/old', branch: 'feat/old', dirty: 0 })] }, deps);
    expect(verbs(queued)).toEqual(['snapshot-push', 'run-tests', 'staging-sync', 'snapshot-push', 'clean-worktree']);
    expect(queued[1]).toEqual({ machine: 'danh', verb: 'run-tests', branch: 'feat/a' });
    expect(queued[4]).toEqual({ machine: 'danh', verb: 'clean-worktree', path: '/w/old', branch: 'feat/old' });
    expect(summary).toMatchObject({ ok: true, staged: 1, cleaned: 1 });
    expect(events.filter((e) => e.status === 'running').map((e) => e.step)).toEqual(['backup', 'tests', 'staging', 'readback', 'backup', 'clean']);
  });

  it('TC-CLEAN-RUN-02: failing tests stop that branch, name the step, and nothing after it runs', async () => {
    const { deps, queued, events } = harness((input) => (input.verb === 'run-tests' ? { state: 'failed', detail: '3 specs đỏ' } : { state: 'success' }));
    const summary = await runCleanup({ staging: [item(), item({ path: '/w/b', branch: 'feat/b', dirty: 2 })], junk: [item({ path: '/w/old', dirty: 0 })] }, deps);
    expect(verbs(queued)).toEqual(['snapshot-push', 'run-tests']);
    expect(summary.ok).toBe(false);
    const failed = events.find((e) => e.status === 'failed');
    expect(failed).toMatchObject({ step: 'tests', branch: 'feat/a', detail: '3 specs đỏ' });
    expect(events.filter((e) => e.status === 'skipped').map((e) => e.path).sort()).toEqual(['/w/b', '/w/old']);
  });

  it('TC-CLEAN-RUN-03: a branch not seen on staging in time is reported as not seen and nothing is cleaned', async () => {
    const { deps, queued, events } = harness(undefined, () => false);
    const summary = await runCleanup({ staging: [item()], junk: [item({ path: '/w/old', dirty: 0 })] }, deps);
    expect(verbs(queued)).toEqual(['snapshot-push', 'run-tests', 'staging-sync']);
    expect(summary).toMatchObject({ ok: false, staged: 0, cleaned: 0 });
    expect(events.find((e) => e.status === 'failed')).toMatchObject({ step: 'readback', detail: expect.stringContaining('chưa thấy trên staging') });
  });

  it('retries the read-back and succeeds once the hub reports the branch staged', async () => {
    const { deps, queued } = harness(undefined, (_target, call) => call >= 3);
    const summary = await runCleanup({ staging: [item()], junk: [] }, deps);
    expect(summary).toMatchObject({ ok: true, staged: 1 });
    expect(verbs(queued)).toEqual(['snapshot-push', 'run-tests', 'staging-sync']);
  });

  it('TC-CLEAN-RUN-04: junk that turned dirty is refused by its machine and skipped, never forced; the rest continue', async () => {
    const { deps, queued, events } = harness((input) => (input.verb === 'clean-worktree' && input.path === '/w/dirty' ? { state: 'refused', detail: '2 uncommitted path(s)' } : { state: 'success' }));
    const summary = await runCleanup({ staging: [], junk: [item({ path: '/w/dirty', dirty: 0 }), item({ path: '/w/fine', dirty: 0 })] }, deps);
    expect(summary).toMatchObject({ cleaned: 1, skipped: 1 });
    expect(events.find((e) => e.status === 'skipped')).toMatchObject({ step: 'clean', path: '/w/dirty', detail: '2 uncommitted path(s)' });
    expect(queued.filter((q) => q.verb === 'clean-worktree').map((q) => q.path)).toEqual(['/w/dirty', '/w/fine']);
  });

  it('a failed backup keeps the junk checkout: it is never removed without one', async () => {
    const { deps, queued } = harness((input) => (input.verb === 'snapshot-push' ? { state: 'failed', detail: 'push refused' } : { state: 'success' }));
    const summary = await runCleanup({ staging: [], junk: [item({ dirty: 0 })] }, deps);
    expect(verbs(queued)).toEqual(['snapshot-push']);
    expect(summary).toMatchObject({ cleaned: 0, failed: 1 });
  });

  it('TC-CLEAN-RUN-05: a protected branch, a local reporter or a conflicting pair is refused before any command is queued', async () => {
    for (const staging of [
      [item({ branch: 'main' })],
      [item({ branch: 'origin/production' })],
      [item({ machine: 'local-pc' })],
      [item({ branch: null })],
    ]) {
      const { deps, queued } = harness();
      const summary = await runCleanup({ staging, junk: [] }, deps);
      expect(queued).toEqual([]);
      expect(summary.ok).toBe(false);
      expect(summary.refused).toBeTruthy();
    }
    const { deps, queued } = harness();
    deps.overlaps.push({ repo: 'shop', machines: ['danh', 'danh1'], verdict: 'conflict' });
    const summary = await runCleanup({ staging: [item(), item({ machine: 'danh1', path: '/w/b', branch: 'feat/b' })], junk: [] }, deps);
    expect(queued).toEqual([]);
    expect(summary.blocked).toHaveLength(1);
    expect(summary.refused).toMatch(/feat\/a/);
  });

  it('stages branches one at a time, fewest changes first, each read back before the next', async () => {
    const order: string[] = [];
    const { deps } = harness(undefined, (target) => { order.push(`read:${target.branch}`); return true; });
    const queue = deps.queue;
    deps.queue = async (input) => { if (input.verb === 'staging-sync') order.push(`sync:${input.branch}`); return queue(input); };
    await runCleanup({ staging: [item({ path: '/w/big', branch: 'feat/big', dirty: 9 }), item({ path: '/w/small', branch: 'feat/small', dirty: 1 })], junk: [] }, deps);
    expect(order).toEqual(['sync:feat/small', 'read:feat/small', 'sync:feat/big', 'read:feat/big']);
  });
});
