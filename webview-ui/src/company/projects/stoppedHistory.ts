/** The full "Vừa ngủ / tắt" list the history dialog has loaded so far, page by page. */

import type { ProjectStoppedPageMessage, ProjectTreeNode } from '../../../../core/src/messages.js';

export interface StoppedHistory {
  readonly items: readonly ProjectTreeNode[];
  /** How many sessions match the search over all pages, as the server last counted. */
  readonly total: number;
  /** The cursor of the next page; undefined once the last page is in. */
  readonly nextCursor: string | undefined;
}

export const EMPTY_STOPPED_HISTORY: StoppedHistory = { items: [], total: 0, nextCursor: undefined };

/** The first page replaces the list; a later one is appended, leaving out a session already listed. */
export function withStoppedPage(history: StoppedHistory, page: ProjectStoppedPageMessage, first: boolean): StoppedHistory {
  const held = first ? new Set<string>() : new Set(history.items.map((node) => node.id));
  const items = [...(first ? [] : history.items), ...page.items.filter((node) => !held.has(node.id))];
  return { items, total: page.total, nextCursor: page.nextCursor };
}
