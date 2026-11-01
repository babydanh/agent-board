import type { FleetSnapshotMessage } from '../../../core/src/messages.js';
import { FLEET_PROMPT_CACHE_MS } from './constants.js';

type Machine = FleetSnapshotMessage['machines'][number];

/** Reads the last prompts of every tmux session of one machine; a failure keeps the previous answer. */
export type PeekPrompts = (machine: string) => Promise<Map<string, string[]>>;

interface Entry {
  at: number;
  prompts: Map<string, string[]>;
  running: boolean;
}

/**
 * Adds each cloud session's last prompts (`recentRequests`) to the snapshot. Like the ask watch it never makes a snapshot
 * wait: answers are cached per machine and refreshed in the background, so the prompts show from the second snapshot on.
 */
export function createPromptWatch(peek: PeekPrompts, now: () => number = Date.now) {
  const cache = new Map<string, Entry>();

  function refresh(machine: string): void {
    const entry = cache.get(machine) ?? { at: Number.NEGATIVE_INFINITY, prompts: new Map<string, string[]>(), running: false };
    cache.set(machine, entry);
    if (entry.running || now() - entry.at <= FLEET_PROMPT_CACHE_MS) return;
    entry.running = true;
    peek(machine)
      .then((prompts) => {
        entry.prompts = prompts;
      })
      .catch(() => undefined)
      .finally(() => {
        entry.at = now();
        entry.running = false;
      });
  }

  return {
    annotate(snapshot: FleetSnapshotMessage): FleetSnapshotMessage {
      return {
        ...snapshot,
        machines: snapshot.machines.map((machine: Machine) => {
          if (machine.state !== 'online' || (machine.tmuxSessions ?? []).length === 0) return machine;
          refresh(machine.agentId);
          const prompts = cache.get(machine.agentId)?.prompts;
          if (prompts === undefined || prompts.size === 0) return machine;
          return {
            ...machine,
            tmuxSessions: (machine.tmuxSessions ?? []).map((session) => {
              const recent = prompts.get(session.name);
              return recent === undefined || recent.length === 0 ? session : { ...session, recentRequests: recent };
            }),
          };
        }),
      };
    },
  };
}
