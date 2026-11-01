import type { FleetSnapshotMessage } from '../../../core/src/messages.js';
import { FLEET_ASK_CACHE_MS, FLEET_ASK_MIN_IDLE_S } from './constants.js';

type Machine = FleetSnapshotMessage['machines'][number];
type Session = NonNullable<Machine['tmuxSessions']>[number];

/** Reads the asking sessions of one machine; a failure counts as "none asking", never as an error for the snapshot. */
export type PeekAsking = (machine: string, sessions: string[]) => Promise<Map<string, string>>;

interface Entry {
  at: number;
  /** Session name → what its menu asks. */
  asking: Map<string, string>;
  running: boolean;
}

/** An idle Claude (or unknown) session of an online machine: the only kind that can be sitting on a menu. */
function peekable(machine: Machine, session: Session): boolean {
  return machine.state === 'online' && session.idleSeconds >= FLEET_ASK_MIN_IDLE_S && (session.engine === undefined || session.engine === 'claude');
}

/**
 * Marks tmux sessions that wait on a menu (`asking`). The snapshot never waits for a peek: each machine's answer is
 * cached and refreshed in the background, so a cloud question shows from the second snapshot on.
 */
export function createAskWatch(peek: PeekAsking, now: () => number = Date.now) {
  const cache = new Map<string, Entry>();

  function refresh(machine: string, sessions: string[]): void {
    const entry = cache.get(machine) ?? { at: Number.NEGATIVE_INFINITY, asking: new Map<string, string>(), running: false };
    cache.set(machine, entry);
    if (entry.running || now() - entry.at <= FLEET_ASK_CACHE_MS) return;
    entry.running = true;
    peek(machine, sessions)
      .catch(() => new Map<string, string>())
      .then((asking) => {
        entry.asking = asking;
        entry.at = now();
        entry.running = false;
      });
  }

  return {
    annotate(snapshot: FleetSnapshotMessage): FleetSnapshotMessage {
      return {
        ...snapshot,
        machines: snapshot.machines.map((machine) => {
          const candidates = (machine.tmuxSessions ?? []).filter((session) => peekable(machine, session));
          if (candidates.length === 0) return machine;
          refresh(machine.agentId, candidates.map((session) => session.name));
          const asking = cache.get(machine.agentId)?.asking ?? new Map<string, string>();
          const names = new Set(candidates.map((session) => session.name));
          return {
            ...machine,
            tmuxSessions: (machine.tmuxSessions ?? []).map((session) => {
              const question = names.has(session.name) ? asking.get(session.name) : undefined;
              return question === undefined ? session : { ...session, asking: true, question };
            }),
          };
        }),
      };
    },
  };
}
