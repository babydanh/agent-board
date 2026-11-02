import { type BlockingPair, blockingPairs } from '../../../../core/src/cleanupBlock.js';
import type { FleetCleanupItem, FleetCleanupPlanMessage, FleetOverlapWarning } from '../../../../core/src/messages.js';

/** Tick keys are `machine NUL path`: the same checkout path can exist on two machines. */
export const keyOf = (item: Pick<FleetCleanupItem, 'machine' | 'path'>): string => `${item.machine}\u0000${item.path}`;

export interface CleanupView {
  readonly staging: FleetCleanupItem[];
  readonly junk: FleetCleanupItem[];
  readonly blocked: BlockingPair<FleetCleanupItem>[];
  readonly canStart: boolean;
}

/** What the ticks mean right now: the chosen items, the pairs git cannot merge, and whether Start may be pressed (design decision 13). */
export function cleanupView(plan: FleetCleanupPlanMessage | null, ticked: ReadonlySet<string>, overlaps: readonly FleetOverlapWarning[]): CleanupView {
  const staging = plan?.staging.filter((item) => ticked.has(keyOf(item))) ?? [];
  const junk = plan?.junk.filter((item) => ticked.has(keyOf(item))) ?? [];
  const blocked = blockingPairs(staging, overlaps);
  return { staging, junk, blocked, canStart: staging.length + junk.length > 0 && blocked.length === 0 };
}
