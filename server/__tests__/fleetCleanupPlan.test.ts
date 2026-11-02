import { describe, expect, it } from 'vitest';

import type { GitGuardWorktree } from '../../core/src/messages.js';
import { planCleanup } from '../src/fleet/cleanupPlan.js';
import type { FleetHubMachine } from '../src/fleet/hubClient.js';

const DAY_MIN = 24 * 60;

const worktree = (over: Partial<GitGuardWorktree> = {}): GitGuardWorktree => ({
  path: '/data/home/wt/a',
  branch: 'feat/a',
  head: 'a'.repeat(40),
  unpushed: 0,
  unpushedSubjects: [],
  backedUp: false,
  dirty: 0,
  dirtyKnown: true,
  dirtyOldestMinutes: null,
  op: null,
  mergedToMain: false,
  idleDays: 5,
  idleMinutes: 5 * DAY_MIN,
  prunable: false,
  ...over,
});

const machine = (id: string, worktrees: GitGuardWorktree[], extra: Partial<FleetHubMachine> = {}, repoPath = '/data/home/repo'): FleetHubMachine => ({
  agent_id: id,
  received_at: 1,
  sessions: [],
  repos: [],
  guard: { machine: id, scannedAt: '2026-11-02T00:00:00.000Z', repos: [{ repo: repoPath, worktrees }], risks: [] },
  ...extra,
});

const plan = (worktrees: GitGuardWorktree[], extra: Partial<FleetHubMachine> = {}) => planCleanup([machine('danh', worktrees, extra)]);

describe('planCleanup', () => {
  it('TC-CLEAN-CLASS-01: merged, empty or prunable checkouts are junk; dirty or unpushed ones are real work for staging', () => {
    const result = plan([
      worktree({ path: '/w/merged', branch: 'feat/merged', mergedToMain: true }),
      worktree({ path: '/w/gone', branch: 'feat/gone', prunable: true }),
      worktree({ path: '/w/dirty', branch: 'feat/dirty', dirty: 3 }),
      worktree({ path: '/w/unpushed', branch: 'feat/unpushed', unpushed: 2 }),
    ]);
    expect(result.junk.map((item) => item.path).sort()).toEqual(['/w/gone', '/w/merged']);
    expect(result.staging.map((item) => item.path).sort()).toEqual(['/w/dirty', '/w/unpushed']);
    expect(result.staging.find((item) => item.path === '/w/dirty')).toMatchObject({ machine: 'danh', branch: 'feat/dirty', dirty: 3 });
  });

  it('TC-CLEAN-CLASS-02: an unknown state is never junk and never offered for staging', () => {
    const result = plan([
      worktree({ path: '/w/unknown', dirtyKnown: false, mergedToMain: true }),
      worktree({ path: '/w/busy', op: 'rebase', mergedToMain: true }),
      worktree({ path: '/w/detached', branch: null, dirty: 1 }),
    ]);
    expect(result.junk).toEqual([]);
    expect(result.staging).toEqual([]);
    expect(result.kept.map((item) => item.path).sort()).toEqual(['/w/busy', '/w/detached', '/w/unknown']);
    for (const item of result.kept) expect(item.reason).not.toBe('');
  });

  it('TC-CLEAN-CLASS-03: a checkout with a live session or changed in the last 24 hours is real, not junk', () => {
    const result = plan(
      [
        worktree({ path: '/w/session', mergedToMain: true }),
        worktree({ path: '/w/recent', mergedToMain: true, idleDays: 0, idleMinutes: 60 }),
        worktree({ path: '/w/tmux', mergedToMain: true }),
        worktree({ path: '/w/old', mergedToMain: true }),
      ],
      { sessions: [{ engine: 'claude', pid: 1, cwd: '/w/session', branch: 'x' }], tmux: [{ name: 'agent', cwd: '/w/tmux', attached: false, idle_seconds: 5 }] },
    );
    expect(result.junk.map((item) => item.path)).toEqual(['/w/old']);
    expect(result.kept.map((item) => item.path).sort()).toEqual(['/w/recent', '/w/session', '/w/tmux']);
  });

  it('TC-CLEAN-CLASS-04: every item names the machine that owns the checkout, and a machine is never planned from another one\'s rows', () => {
    const result = planCleanup([
      machine('danh', [worktree({ path: '/w/one', mergedToMain: true }), worktree({ path: '/w/two', branch: 'feat/two', dirty: 1 })]),
      machine('danh1', [worktree({ path: '/w/one', mergedToMain: true })]),
    ]);
    expect(result.junk.map((item) => `${item.machine}:${item.path}`).sort()).toEqual(['danh1:/w/one', 'danh:/w/one']);
    expect(result.staging.map((item) => item.machine)).toEqual(['danh']);
    // A report whose guard names a different machine than the row that carried it is not trusted.
    const forged = planCleanup([machine('danh', [worktree({ mergedToMain: true })], {}, '/r'), { ...machine('danh1', [worktree({ mergedToMain: true })]), guard: { machine: 'danh', scannedAt: 'x', repos: [{ repo: '/r', worktrees: [worktree({ mergedToMain: true })] }], risks: [] } }]);
    expect(forged.junk.map((item) => item.machine)).toEqual(['danh']);
  });

  it('never offers the main checkout, a protected branch or a local reporter', () => {
    const result = planCleanup([
      machine('danh', [
        worktree({ path: '/data/home/repo', branch: 'main', mergedToMain: true }),
        worktree({ path: '/w/prod', branch: 'production', dirty: 2 }),
        worktree({ path: '/w/ok', branch: 'feat/ok', dirty: 1 }),
      ]),
      machine('local-pc', [worktree({ path: 'C:/x', branch: 'feat/x', dirty: 1 })]),
    ]);
    expect(result.junk).toEqual([]);
    expect(result.staging.map((item) => item.path)).toEqual(['/w/ok']);
    expect(result.kept.map((item) => item.path)).toContain('/w/prod');
  });

  it('a machine without a guard report contributes nothing', () => {
    expect(planCleanup([{ agent_id: 'danh', received_at: 1, sessions: [], repos: [] }])).toEqual({ staging: [], junk: [], kept: [] });
  });
});
