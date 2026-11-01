import { describe, expect, it } from 'vitest';

import type { FleetMachineSnapshot } from '../../core/src/messages.js';
import { lastSeenLabel, splitMachines } from '../src/company/fleet/sleepingMachines.js';

function machine(agentId: string, state: FleetMachineSnapshot['state'], receivedAt = 1_000): FleetMachineSnapshot {
  return { agentId, state, receivedAt, sessionCount: 0, engines: [], repos: [] } as unknown as FleetMachineSnapshot;
}

describe('splitMachines (TC-SLEEPERS-01)', () => {
  it('keeps online machines on the page and moves every other machine to the sleepers, order kept', () => {
    const { awake, asleep } = splitMachines([machine('danh', 'online'), machine('danh2', 'stale'), machine('danh1', 'online'), machine('danh3', 'stale')]);

    expect(awake.map((m) => m.agentId)).toEqual(['danh', 'danh1']);
    expect(asleep.map((m) => m.agentId)).toEqual(['danh2', 'danh3']);
  });

  it('is empty on both sides for no machines', () => {
    expect(splitMachines([])).toEqual({ awake: [], asleep: [] });
  });
});

describe('lastSeenLabel (TC-SLEEPERS-02)', () => {
  it('says "chưa rõ" for a machine that never reported instead of printing 1970', () => {
    expect(lastSeenLabel(0)).toBe('chưa rõ');
    expect(lastSeenLabel(-5)).toBe('chưa rõ');
  });

  it('prints a date for a real report time', () => {
    expect(lastSeenLabel(Date.UTC(2026, 10, 1, 12, 0))).toMatch(/2026|26/);
  });
});
