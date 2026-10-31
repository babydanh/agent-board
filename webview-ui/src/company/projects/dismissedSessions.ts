import type { ProjectTreeNode } from '../../../../core/src/messages.js';
import { isEndedNode } from './projectTreeView.js';

/** Ended sessions the user cleared from the sidebar, kept in this browser: the server only reads them from the activity ledger. */
export type DismissedSessions = Readonly<Record<string, number>>;

export const DISMISSED_SESSIONS_KEY = 'omp.company.dismissedSessions';
/** The server lists an ended session for a day, so a longer memory only grows the stored map. */
const DISMISSED_KEEP_MS = 3 * 86_400_000;

function keyOf(node: ProjectTreeNode): string {
  return node.sessionId ?? node.id;
}

export function parseDismissed(raw: string | null): DismissedSessions {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  } catch {
    return {};
  }
}

export function readDismissed(): DismissedSessions {
  try {
    return parseDismissed(window.localStorage.getItem(DISMISSED_SESSIONS_KEY));
  } catch {
    return {};
  }
}

export function writeDismissed(dismissed: DismissedSessions): void {
  try {
    window.localStorage.setItem(DISMISSED_SESSIONS_KEY, JSON.stringify(dismissed));
  } catch {
    // Storage is optional in embedded and restricted browser contexts.
  }
}

/** The map with every ended session in `nodes` added (each once) and entries past their keep time dropped. */
export function dismissEnded(nodes: readonly ProjectTreeNode[], current: DismissedSessions, now: number): DismissedSessions {
  const next: Record<string, number> = {};
  for (const [key, at] of Object.entries(current)) if (now - at < DISMISSED_KEEP_MS) next[key] = at;
  for (const node of nodes) if (isEndedNode(node)) next[keyOf(node)] ??= now;
  return next;
}

/** `nodes` without the dismissed ended sessions; a dismissed one that runs again is shown again. */
export function withoutDismissed(nodes: readonly ProjectTreeNode[], dismissed: DismissedSessions): readonly ProjectTreeNode[] {
  if (Object.keys(dismissed).length === 0) return nodes;
  return nodes.filter((node) => !(isEndedNode(node) && keyOf(node) in dismissed));
}
