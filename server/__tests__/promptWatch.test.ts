import { describe, expect, it, vi } from 'vitest';

import type { FleetSnapshotMessage } from '../../core/src/messages.js';
import { FLEET_PROMPT_CACHE_MS } from '../src/fleet/constants.js';
import { createPromptWatch } from '../src/fleet/promptWatch.js';

type Machine = FleetSnapshotMessage['machines'][number];

function machine(agentId: string, names: string[], state: 'online' | 'stale' = 'online'): Machine {
  return {
    agentId,
    state,
    tmuxSessions: names.map((name) => ({ name, attached: false, idleSeconds: 30 })),
  } as unknown as Machine;
}

function snapshot(...machines: Machine[]): FleetSnapshotMessage {
  return { type: 'fleetSnapshot', requestId: 'r', machines } as unknown as FleetSnapshotMessage;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const promptsOf = (snap: FleetSnapshotMessage, name: string) => snap.machines[0]?.tmuxSessions?.find((s) => s.name === name)?.recentRequests;

describe('createPromptWatch', () => {
  it('never waits: the first snapshot is unchanged, the next carries the prompts', async () => {
    const peek = vi.fn(async () => new Map([['fix', ['new', 'old']]]));
    const watch = createPromptWatch(peek, () => 0);

    expect(promptsOf(watch.annotate(snapshot(machine('danh1', ['fix']))), 'fix')).toBeUndefined();
    await flush();

    expect(peek).toHaveBeenCalledWith('danh1');
    expect(promptsOf(watch.annotate(snapshot(machine('danh1', ['fix']))), 'fix')).toEqual(['new', 'old']);
  });

  it('does not read an offline machine', async () => {
    const peek = vi.fn(async () => new Map<string, string[]>());
    createPromptWatch(peek, () => 0).annotate(snapshot(machine('danh1', ['fix'], 'stale')));
    await flush();

    expect(peek).not.toHaveBeenCalled();
  });

  it('reuses an answer for the cache time, then asks again', async () => {
    let now = 0;
    const peek = vi.fn(async () => new Map<string, string[]>());
    const watch = createPromptWatch(peek, () => now);
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    await flush();
    now = FLEET_PROMPT_CACHE_MS - 1;
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    await flush();
    expect(peek).toHaveBeenCalledTimes(1);
    now = FLEET_PROMPT_CACHE_MS + 1;
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    await flush();

    expect(peek).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good answer when a later read fails', async () => {
    let now = 0;
    let fail = false;
    const watch = createPromptWatch(async () => {
      if (fail) throw new Error('timeout');
      return new Map([['fix', ['kept']]]);
    }, () => now);
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    await flush();
    fail = true;
    now = FLEET_PROMPT_CACHE_MS + 1;
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    await flush();

    expect(promptsOf(watch.annotate(snapshot(machine('danh1', ['fix']))), 'fix')).toEqual(['kept']);
  });

  it('starts only one read per machine at a time', async () => {
    let release: () => void = () => undefined;
    const peek = vi.fn(() => new Promise<Map<string, string[]>>((resolve) => { release = () => resolve(new Map()); }));
    const watch = createPromptWatch(peek, () => 0);
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    watch.annotate(snapshot(machine('danh1', ['fix'])));
    release();
    await flush();

    expect(peek).toHaveBeenCalledTimes(1);
  });
});
