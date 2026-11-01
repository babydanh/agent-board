import type { FleetMachineSnapshot } from '../../../../core/src/messages.js';

/** Machines the hub (or InstaBox) reports as awake stay on the page; stale ones sleep behind one popup button. */
export function splitMachines(machines: readonly FleetMachineSnapshot[]): {
  awake: FleetMachineSnapshot[];
  asleep: FleetMachineSnapshot[];
} {
  return {
    awake: machines.filter((machine) => machine.state === 'online'),
    asleep: machines.filter((machine) => machine.state !== 'online'),
  };
}

/** "Chưa rõ" for a machine that never reported (receivedAt 0, listed from InstaBox only), else the local date and time. */
export function lastSeenLabel(receivedAt: number): string {
  if (receivedAt <= 0) return 'chưa rõ';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(receivedAt);
}
