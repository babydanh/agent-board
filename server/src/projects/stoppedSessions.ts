/**
 * stoppedSessions: every session that stopped (exited, killed, or put to sleep in herdr), newest
 * first, one cursor page at a time. The Project tree only carries the last day's newest few; this
 * reads the whole ledger, so "Vừa ngủ / tắt" can show them all and a stopped session of last week
 * can still be found and woken.
 *
 * The cursor is the last item's stop time and key (`<ms>|<key>`), not an offset, so a session that
 * stops between two pages never shifts the next one.
 */

import type { ProjectTreeNode } from '../../../core/src/messages.js';
import type { SessionRow } from '../ledger/ledgerDb.js';
import { LibraryUserError } from '../library/libraryError.js';
import {
  annotateLedgerRows,
  endedMainRows,
  engineForLedger,
  type HerdrProjectSession,
  herdrSessionSnapshot,
  ledgerSessionSnapshot,
  type ProjectSessionSnapshot,
  type ProjectTreeOptions,
  pushSessions,
  withDeadProcessesEnded,
  withPaneFacts,
  withProgress,
} from './projectTree.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const CURSOR = /^(\d+)\|(.+)$/;

export interface StoppedListRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  /** Case-insensitive text looked for in the folder, agent name, session id, transcript name and pane title. */
  readonly query?: string | undefined;
}

export interface StoppedPage {
  readonly items: ProjectTreeNode[];
  /** Absent on the last page. */
  readonly nextCursor?: string;
  /** How many sessions match the query, over all pages. */
  readonly total: number;
}

type StoppedSource =
  | { readonly row: SessionRow; readonly pane?: undefined }
  | { readonly pane: HerdrProjectSession; readonly row?: undefined };

interface StoppedEntry {
  /** The node id the entry becomes: stable and unique, so it orders ties and anchors the cursor. */
  readonly key: string;
  readonly at: number;
  readonly haystack: string;
  readonly source: StoppedSource;
}

type StoppedOptions = Pick<ProjectTreeOptions, 'ledger' | 'isAlive' | 'herdrSessions' | 'boardSessionFor' | 'sessionFacts'>;

function baseName(file: string | null | undefined): string {
  return file?.split(/[\\/]/).pop() ?? '';
}

function stoppedEntries(options: StoppedOptions): StoppedEntry[] {
  const panes = options.herdrSessions?.() ?? [];
  const rows = withDeadProcessesEnded(options.ledger.sessionRows(), options.isAlive);
  const ended = endedMainRows(rows, panes).flatMap(({ row, at }): StoppedEntry[] => {
    if (row.cwd === null || row.cwd === '') return [];
    return [{
      key: `${engineForLedger(row)}:${row.sessionId}`,
      at,
      haystack: [row.cwd, row.agentName, row.sessionId, baseName(row.sessionFile)].join('\n').toLowerCase(),
      source: { row },
    }];
  });
  const asleep = panes.flatMap((pane): StoppedEntry[] => {
    const at = pane.sleptAt === undefined ? Number.NaN : Date.parse(pane.sleptAt);
    if (Number.isNaN(at)) return [];
    return [{
      key: `herdr:${pane.id}`,
      at,
      haystack: [pane.cwd, pane.title, pane.id, pane.sessionId, baseName(pane.sessionFile)].join('\n').toLowerCase(),
      source: { pane },
    }];
  });
  return [...ended, ...asleep].sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

function parseCursor(cursor: string): { at: number; key: string } {
  const match = CURSOR.exec(cursor);
  if (match === null) throw new LibraryUserError('Con trỏ trang không hợp lệ.');
  return { at: Number(match[1]), key: match[2] as string };
}

/** One page of stopped sessions, newest first; `cursor` is a previous page's `nextCursor`. */
export async function listStoppedSessions(options: StoppedOptions, request: StoppedListRequest): Promise<StoppedPage> {
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const needle = request.query?.trim().toLowerCase() ?? '';
  const matches = stoppedEntries(options).filter((entry) => needle === '' || entry.haystack.includes(needle));
  const from = request.cursor === undefined || request.cursor === '' ? undefined : parseCursor(request.cursor);
  const after = from === undefined
    ? matches
    : matches.filter((entry) => entry.at < from.at || (entry.at === from.at && entry.key < from.key));
  const page = after.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = after.length > limit && last !== undefined ? `${last.at}|${last.key}` : undefined;
  // Transcript facts are read for this page only: the whole history would read every transcript.
  const rows = await withProgress(
    annotateLedgerRows(page.flatMap((entry) => (entry.source.row === undefined ? [] : [entry.source.row])), options.ledger, options.boardSessionFor),
    options.sessionFacts,
  );
  const panes = await withPaneFacts(page.flatMap((entry) => (entry.source.pane === undefined ? [] : [entry.source.pane])), options.sessionFacts);
  const snapshots = new Map<string, ProjectSessionSnapshot>([
    ...rows.map((row): [string, ProjectSessionSnapshot] => [`${engineForLedger(row)}:${row.sessionId}`, ledgerSessionSnapshot(row, row.cwd ?? '')]),
    ...panes.map((pane): [string, ProjectSessionSnapshot] => [`herdr:${pane.id}`, herdrSessionSnapshot(pane)]),
  ]);
  const items: ProjectTreeNode[] = [];
  for (const entry of page) {
    const snapshot = snapshots.get(entry.key);
    if (snapshot !== undefined) pushSessions(items, snapshot.cwd, [snapshot]);
  }
  return { items, ...(nextCursor === undefined ? {} : { nextCursor }), total: matches.length };
}
