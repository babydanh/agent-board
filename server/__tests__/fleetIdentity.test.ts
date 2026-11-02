import { describe, expect, it } from 'vitest';

import { computeFleetOverlaps } from '../src/fleet/fleetSnapshot.js';
import type { FleetHubMachine } from '../src/fleet/hubClient.js';

interface RepoOpts {
  readonly githubRepo?: string;
  readonly originMain?: string;
  readonly ranges?: readonly (readonly [number, number])[];
}

function machine(agentId: string, folder: string, files: string[], opts: RepoOpts = {}): FleetHubMachine {
  const ranges = opts.ranges;
  return {
    agent_id: agentId,
    received_at: 1_000,
    sessions: [],
    repos: [
      {
        path: `/work/${folder}`,
        repo: folder,
        branch: 'feature',
        ahead: 0,
        behind: 0,
        dirty_files: ranges ? [] : files,
        ...(opts.githubRepo ? { github_repo: opts.githubRepo } : {}),
        ...(opts.originMain ? { origin_main: opts.originMain } : {}),
        ...(ranges ? { changes: files.map((path) => ({ path, ranges })) } : {}),
      },
    ],
  };
}

describe('repository identity in overlaps', () => {
  it('TC-IDENT-01: different folder names with the same github_repo are one repository', () => {
    const warnings = computeFleetOverlaps(
      [
        machine('local-pc', 'Backend', ['src/a.ts'], { githubRepo: 'github.com/Owner/Api' }),
        machine('danh', 'HethongBackendApi', ['src/a.ts'], { githubRepo: 'github.com/owner/api' }),
      ],
      [],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ repo: 'Backend', path: 'src/a.ts', machines: ['danh', 'local-pc'] });
  });

  it('TC-IDENT-02: the same folder name with different github_repo is never compared', () => {
    const warnings = computeFleetOverlaps(
      [
        machine('danh', 'app', ['src/a.ts'], { githubRepo: 'github.com/one/app' }),
        machine('danh1', 'app', ['src/a.ts'], { githubRepo: 'github.com/two/app' }),
      ],
      [],
    );

    expect(warnings).toEqual([]);
  });

  it('TC-IDENT-03: without github_repo the folder name still matches', () => {
    const warnings = computeFleetOverlaps(
      [machine('danh', 'Web', ['src/a.ts']), machine('danh1', 'web', ['src/a.ts'])],
      [],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ repo: 'Web', path: 'src/a.ts' });
  });

  it('TC-IDENT-04: the local flag still matches by folder name when the entry is keyed by identity', () => {
    const machines = [
      machine('danh', 'HethongBackendApi', ['src/a.ts'], { githubRepo: 'github.com/owner/api' }),
    ];

    const matched = computeFleetOverlaps(machines, [{ repo: 'V:/work/HethongBackendApi', dirtyFiles: ['src/a.ts'] }]);
    const other = computeFleetOverlaps(machines, [{ repo: 'V:/work/Elsewhere', dirtyFiles: ['src/a.ts'] }]);

    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ local: true, level: 'file' });
    expect(other).toEqual([]);
  });
});

describe('base difference in overlaps', () => {
  const identity = { githubRepo: 'github.com/owner/api', ranges: [[10, 20]] as const };

  it('TC-BASE-01: equal origin_main leaves the warning unmarked and at line level', () => {
    const warnings = computeFleetOverlaps(
      [
        machine('danh', 'api', ['src/a.ts'], { ...identity, originMain: 'aaa111' }),
        machine('danh1', 'api', ['src/a.ts'], { ...identity, originMain: 'aaa111' }),
      ],
      [],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe('line');
    expect(warnings[0]).not.toHaveProperty('baseDiffers');
  });

  it('TC-BASE-02: different origin_main marks baseDiffers and forces file level', () => {
    const warnings = computeFleetOverlaps(
      [
        machine('danh', 'api', ['src/a.ts'], { ...identity, originMain: 'aaa111' }),
        machine('danh1', 'api', ['src/a.ts'], { ...identity, originMain: 'bbb222' }),
      ],
      [],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ baseDiffers: true, level: 'file' });
  });

  it('a missing origin_main on one side is not judged', () => {
    const warnings = computeFleetOverlaps(
      [
        machine('danh', 'api', ['src/a.ts'], { ...identity, originMain: 'aaa111' }),
        machine('danh1', 'api', ['src/a.ts'], identity),
      ],
      [],
    );

    expect(warnings[0]?.level).toBe('line');
    expect(warnings[0]).not.toHaveProperty('baseDiffers');
  });
});
