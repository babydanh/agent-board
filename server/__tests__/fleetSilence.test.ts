import { describe, expect, it } from 'vitest';

import type { GitGuardReport, ServerMessage } from '../../core/src/messages.js';
import type { CloudControl } from '../src/fleet/cloudControl.js';
import { type FleetCommandContext, handleFleetMessage } from '../src/fleet/handler.js';
import type { FleetHubClient } from '../src/fleet/hubClient.js';

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const brokenHub: FleetHubClient = { fetchFleet: async () => { throw new Error('Fleet hub responded with 502.'); } };
const noTmux = { readRunningTmux: async () => { throw new Error('no instabox'); } } as unknown as CloudControl;
const localGuard: GitGuardReport = { machine: 'local', scannedAt: '2026-11-02T00:00:00.000Z', repos: [], risks: [] };

function ask(context: Partial<FleetCommandContext>) {
  const sent: ServerMessage[] = [];
  handleFleetMessage({ type: 'fleetRequest', requestId: REQUEST_ID }, (m) => sent.push(m), { ledger: null, privileged: true, fleet: brokenHub, cloud: noTmux, ...context });
  return sent;
}

describe('hub unreachable', () => {
  it('TC-SILENCE-01: with nothing local to show, the board gets a failure with a reason, never an empty fleet', async () => {
    const sent = ask({});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'fleetCommandResult', ok: false, code: 'failed' });
    expect(sent.some((m) => m.type === 'fleetSnapshot')).toBe(false);
  });

  it('TC-SILENCE-01: with local data to show, the snapshot carries hubError so the empty machine list is explained', async () => {
    const sent = ask({ getLocalGuard: () => localGuard });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshot = sent.find((m) => m.type === 'fleetSnapshot');
    expect(snapshot).toMatchObject({ machines: [], hubError: expect.stringMatching(/hub/i) });
  });
});
