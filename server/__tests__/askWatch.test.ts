import { describe, expect, it, vi } from 'vitest';

import type { FleetSnapshotMessage } from '../../core/src/messages.js';
import { createAskWatch } from '../src/fleet/askWatch.js';
import { FLEET_ASK_CACHE_MS, FLEET_ASK_MIN_IDLE_S } from '../src/fleet/constants.js';

type Machine = FleetSnapshotMessage['machines'][number];

function machine(agentId: string, sessions: { name: string; idleSeconds: number; engine?: 'claude' | 'omp' }[], state: Machine['state'] = 'online'): Machine {
  return {
    agentId,
    receivedAt: 0,
    state,
    sessionCount: sessions.length,
    engines: [],
    repos: [],
    tmuxSessions: sessions.map((s) => ({ attached: false, ...s })),
  } as unknown as Machine;
}

function snapshot(...machines: Machine[]): FleetSnapshotMessage {
  return { type: 'fleetSnapshot', requestId: '00000000-0000-4000-8000-000000000000', machines, overlaps: [] } as unknown as FleetSnapshotMessage;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const askingOf = (message: FleetSnapshotMessage, agent: string) => message.machines.find((m) => m.agentId === agent)?.tmuxSessions?.filter((s) => s.asking === true).map((s) => s.name);
const questionOf = (message: FleetSnapshotMessage, agent: string, name: string) => message.machines.find((m) => m.agentId === agent)?.tmuxSessions?.find((s) => s.name === name)?.question;

describe('createAskWatch', () => {
  it('never waits for a peek: the first snapshot is returned as it came, the next one carries the answer', async () => {
    const peek = vi.fn(async () => new Map([['fix', 'Which database? — 1. Postgres']]));
    const watch = createAskWatch(peek, () => 0);
    const first = watch.annotate(snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 300 }])));
    expect(askingOf(first, 'danh1')).toEqual([]);
    await flush();
    expect(peek).toHaveBeenCalledWith('danh1', ['fix']);
    const second = watch.annotate(snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 300 }])));
    expect(askingOf(second, 'danh1')).toEqual(['fix']);
    // TC-CLOUD-ASK-04: the snapshot carries what the menu asks.
    expect(questionOf(second, 'danh1', 'fix')).toBe('Which database? — 1. Postgres');
  });

  it('does not peek a session at work, an omp session or an offline machine', async () => {
    const peek = vi.fn(async () => new Map<string, string>());
    const watch = createAskWatch(peek, () => 0);
    watch.annotate(
      snapshot(
        machine('a', [{ name: 'busy', idleSeconds: FLEET_ASK_MIN_IDLE_S - 1 }, { name: 'ompy', idleSeconds: 500, engine: 'omp' }]),
        machine('b', [{ name: 'idle', idleSeconds: 500 }], 'stale'),
      ),
    );
    await flush();
    expect(peek).not.toHaveBeenCalled();
  });

  it('reuses an answer for the cache time, then asks again', async () => {
    let now = 0;
    const peek = vi.fn(async () => new Map<string, string>());
    const watch = createAskWatch(peek, () => now);
    const snap = () => snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 300 }]));
    watch.annotate(snap());
    await flush();
    now = FLEET_ASK_CACHE_MS - 1;
    watch.annotate(snap());
    await flush();
    expect(peek).toHaveBeenCalledTimes(1);
    now = FLEET_ASK_CACHE_MS + 1;
    watch.annotate(snap());
    await flush();
    expect(peek).toHaveBeenCalledTimes(2);
  });

  it('starts one peek at a time per machine, and a failed peek means "not asking"', async () => {
    const peek = vi.fn(() => new Promise<Map<string, string>>((_, reject) => setTimeout(() => reject(new Error('ssh down')), 5)));
    const watch = createAskWatch(peek, () => 0);
    const snap = () => snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 300 }]));
    watch.annotate(snap());
    watch.annotate(snap());
    expect(peek).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askingOf(watch.annotate(snap()), 'danh1')).toEqual([]);
  });

  it('forgets a session that has started working again', async () => {
    const watch = createAskWatch(async () => new Map([['fix', 'Which?']]), () => 0);
    watch.annotate(snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 300 }])));
    await flush();
    expect(askingOf(watch.annotate(snapshot(machine('danh1', [{ name: 'fix', idleSeconds: 2 }]))), 'danh1')).toEqual([]);
  });
});
