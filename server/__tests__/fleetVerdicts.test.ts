import { describe, expect, it } from 'vitest';

import { computeFleetOverlaps } from '../src/fleet/fleetSnapshot.js';
import type { FleetHubMachine, FleetHubVerdict } from '../src/fleet/hubClient.js';

const REPO = 'github.com/owner/api';
const NOW = 2_000;

function machine(agentId: string, files: string[], verdicts: readonly FleetHubVerdict[] = [], receivedAt = 1_000): FleetHubMachine {
  return {
    agent_id: agentId,
    received_at: receivedAt,
    sessions: [],
    verdicts,
    repos: [{ path: '/work/api', repo: 'api', github_repo: REPO, branch: 'feature', ahead: 0, behind: 0, dirty_files: files }],
  };
}

const verdict = (extra: Partial<FleetHubVerdict> = {}): FleetHubVerdict => ({
  repo: REPO, a: 'danh/feature', b: 'local-pc/feature', file: 'src/a.ts', status: 'conflict', ranges: [[5, 7]], ...extra,
});

describe('exact verdicts in overlaps', () => {
  it('TC-VERDICT-08: a conflict verdict marks the matching warning and names the pair and the lines', () => {
    const warnings = computeFleetOverlaps([machine('danh', ['src/a.ts'], [verdict()]), machine('local-pc', ['src/a.ts'])], [], NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: 'src/a.ts', verdict: 'conflict', machines: ['danh', 'local-pc'] });
    expect(warnings[0].detail).toContain('git');
    expect(warnings[0].detail).toContain('5');
  });

  it('TC-VERDICT-09: an auto verdict keeps the approximate warning but says git merges it by itself', () => {
    const warnings = computeFleetOverlaps([machine('danh', ['src/a.ts'], [verdict({ status: 'auto', ranges: undefined })]), machine('local-pc', ['src/a.ts'])], [], NOW);
    expect(warnings[0]).toMatchObject({ path: 'src/a.ts', verdict: 'auto' });
  });

  it('TC-VERDICT-10: a conflict seen only in the snapshots still produces a warning for the two machines', () => {
    const warnings = computeFleetOverlaps([machine('danh', [], [verdict()]), machine('local-pc', [])], [], NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: 'src/a.ts', verdict: 'conflict', machines: ['danh', 'local-pc'], level: 'line' });
  });

  it('TC-VERDICT-11: an incomplete pair is never shown as clean or auto', () => {
    const warnings = computeFleetOverlaps(
      [machine('danh', ['src/a.ts'], [verdict({ file: '', status: 'incomplete', ranges: undefined })]), machine('local-pc', ['src/a.ts'])], [], NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].verdict).toBe('incomplete');
  });

  it('TC-VERDICT-12: verdicts from a machine that went silent are ignored', () => {
    const stale = 1_000 + 11 * 60 * 1000;
    const warnings = computeFleetOverlaps([machine('danh', ['src/a.ts'], [verdict()]), machine('local-pc', ['src/a.ts'])], [], stale);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].verdict).toBeUndefined();
  });

  it('TC-VERDICT-13: a verdict for another repository never touches this one', () => {
    const warnings = computeFleetOverlaps(
      [machine('danh', ['src/a.ts'], [verdict({ repo: 'github.com/owner/other' })]), machine('local-pc', ['src/a.ts'])], [], NOW);
    const ours = warnings.filter((warning) => warning.repo === 'api');
    expect(ours).toHaveLength(1);
    expect(ours[0].verdict).toBeUndefined();
  });
});
