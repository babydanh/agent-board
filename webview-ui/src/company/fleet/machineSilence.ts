import type { FleetMachineSnapshot } from '../../../../core/src/messages.js';

const MINUTE_MS = 60_000;
const HOUR_MIN = 60;
const DAY_MIN = 24 * 60;

/** How long a machine has been silent, in the largest unit that keeps the number small. */
function span(minutes: number): string {
  if (minutes >= DAY_MIN) return `${Math.floor(minutes / DAY_MIN)} ngày`;
  if (minutes >= HOUR_MIN) return `${Math.floor(minutes / HOUR_MIN)} giờ`;
  return `${Math.max(1, minutes)} phút`;
}

/** The state line of a machine card. A silent machine is a warning with its silence length, not an error: it may just be asleep. */
export function silenceLabel(state: FleetMachineSnapshot['state'], receivedAt: number, nowMs: number): { text: string; className: string } {
  if (state !== 'stale') return { text: 'Đang hoạt động', className: 'text-text-muted' };
  const minutes = Math.floor(Math.max(0, nowMs - receivedAt) / MINUTE_MS);
  return { text: `Im lặng ${span(minutes)} (ngủ hoặc mất kết nối)`, className: 'text-warning' };
}
