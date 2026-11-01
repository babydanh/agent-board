import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { CloudControl } from '../src/fleet/cloudControl.js';
import { splitLocalReporters } from '../src/fleet/fleetSnapshot.js';
import { handleFleetMessage } from '../src/fleet/handler.js';
import type { FleetHubClient, FleetHubMachine } from '../src/fleet/hubClient.js';

function reporting(agent_id: string, repo: string, path: string, dirty: string[]): FleetHubMachine {
  return { agent_id, received_at: 1_000, sessions: [], repos: [{ path, repo, branch: 'main', ahead: 0, behind: 0, dirty_files: dirty }] };
}

describe('splitLocalReporters (TC-LOCALREPORT-01)', () => {
  it('moves machines named local-… out of the cloud list and keeps the rest in order', () => {
    const response = {
      now: 5,
      machines: [reporting('danh', 'Web', '/data/home/Web', []), reporting('local-pc', 'Web', 'V:/Web', []), reporting('danh1', 'Web', '/data/home/Web', [])],
    };

    const { cloud, reporters } = splitLocalReporters(response);

    expect(cloud.machines.map((machine) => machine.agent_id)).toEqual(['danh', 'danh1']);
    expect(reporters.map((machine) => machine.agent_id)).toEqual(['local-pc']);
    expect(cloud.now).toBe(5);
  });
});

describe('local reporters in the snapshot (TC-LOCALREPORT-02)', () => {
  it('counts a local reporter for file overlaps but never shows it as a cloud machine', async () => {
    const sent: ServerMessage[] = [];
    const fleet: FleetHubClient = {
      fetchFleet: vi.fn(async () => ({
        now: 1_000,
        machines: [reporting('danh', 'Web', '/data/home/Web', ['src/a.ts']), reporting('local-pc', 'Web', 'V:/Web', ['src/a.ts', 'src/b.ts'])],
      })),
    };
    // InstaBox must never be reached by this test: every command answers "failed".
    const cloud = new CloudControl({
      listConfigHomes: async () => ['/config'],
      run: async () => ({ code: 1, stdout: '', stderr: '' }),
      launcher: { file: 'instabox', args: [] },
      now: () => 1_000_000,
      forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
    });

    handleFleetMessage({ type: 'fleetRequest', requestId: 'request-9' }, (message) => sent.push(message), {
      fleet,
      cloud,
      ledger: null,
      privileged: true,
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(1));

    expect(sent[0]).toMatchObject({ type: 'fleetSnapshot' });
    const snapshot = sent[0] as Extract<ServerMessage, { type: 'fleetSnapshot' }>;
    expect(snapshot.machines.map((machine) => machine.agentId)).toEqual(['danh']);
    expect(snapshot.overlaps).toHaveLength(1);
    expect(snapshot.overlaps[0]).toMatchObject({ repo: 'Web', path: 'src/a.ts', machines: expect.arrayContaining(['danh', 'local-pc']) });
  });
});
