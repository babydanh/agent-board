/**
 * StoppedHistoryDialog: every session that stopped ("Vừa ngủ / tắt"), not only the few the sidebar lists.
 *
 * The server pages the whole activity ledger newest first by cursor. The list loads its first page
 * on open, the next one when its end scrolls into view (or "Tải thêm" is pressed), and a search box
 * asks the server again from the top. A click opens the same details dialog the sidebar rows open,
 * where the session is woken; this one stays open beneath it so the next one can be chosen.
 */

import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ProjectTreeNode } from '../../../../core/src/messages.js';
import { CompanyButton } from '../components/CompanyButton.js';
import { useNow } from '../useNow.js';
import { fetchStoppedPage, type ProjectStore } from './projectStore.js';
import { UnfinishedMark } from './ProjectTree.js';
import { sessionCode, sessionDisplayName, sessionFaceHue, sessionFaceMood, stoppedLabel } from './projectTreeView.js';
import { SessionFace } from './SessionFace.js';
import { EMPTY_STOPPED_HISTORY, type StoppedHistory, withStoppedPage } from './stoppedHistory.js';

/** Sessions asked for per page. */
const PAGE_SIZE = 30;
/** How long the search box waits after the last keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

export interface StoppedHistoryDialogProps {
  readonly store: ProjectStore;
  /** Opens a session's details (its prompts, last answer and wake). */
  readonly onOpen: (node: ProjectTreeNode) => void;
  readonly onClose: () => void;
}

/** The last segment of a folder path: the name a session's row shows under it. */
function folderName(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).pop();
}

export function StoppedHistoryDialog({ store, onOpen, onClose }: StoppedHistoryDialogProps) {
  const now = useNow();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<StoppedHistory>(EMPTY_STOPPED_HISTORY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the newest load may touch the screen: a slow page of an old search must not replace a new one.
  const generation = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [opener] = useState<Element | null>(() => document.activeElement);

  const load = useCallback(async (cursor?: string): Promise<void> => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    const outcome = await fetchStoppedPage(store, {
      limit: PAGE_SIZE,
      ...(query === '' ? {} : { query }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (mine !== generation.current) return;
    if ('page' in outcome) setHistory((held) => withStoppedPage(held, outcome.page, cursor === undefined));
    else if ('refusal' in outcome) setError(outcome.refusal);
    setLoading(false);
  }, [store, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  // A new search starts from the newest session again.
  useEffect(() => {
    setHistory(EMPTY_STOPPED_HISTORY);
    void load();
  }, [load]);

  useEffect(() => {
    searchBox.current?.focus();
    return () => {
      generation.current += 1;
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [opener]);

  // The end of the list scrolling into view asks for the next page; a failed page waits for "Thử lại" instead of looping.
  const next = history.nextCursor;
  useEffect(() => {
    const end = sentinel.current;
    if (end === null || next === undefined || loading || error !== null || typeof IntersectionObserver === 'undefined') return undefined;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(next);
    }, { root: list.current });
    watcher.observe(end);
    return () => watcher.disconnect();
  }, [next, loading, error, load]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const searching = query !== '';
  const dialog = (
    <div className="company-ui">
      <div className="fixed inset-0 z-40 flex items-center justify-center">
        <button type="button" aria-label="Đóng danh sách phiên đã tắt" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stopped-history-title"
          data-testid="stopped-history-dialog"
          onKeyDown={onKeyDown}
          className="relative flex max-h-[90vh] min-h-[50vh] w-[min(620px,94vw)] flex-col gap-2 rounded-(--company-radius-md) bg-panel p-3 text-xs text-text max-md:h-full max-md:max-h-none max-md:w-full max-md:rounded-none"
        >
          <header className="flex items-center gap-2">
            <h2 id="stopped-history-title" className="min-w-0 flex-1 text-sm text-text">
              Vừa ngủ / tắt
              <span className="ml-2 text-2xs font-normal text-text-muted" data-testid="stopped-history-count">
                {history.items.length}/{history.total} phiên
              </span>
            </h2>
            <CompanyButton type="button" size="sm" aria-label="Đóng" onClick={onClose}>×</CompanyButton>
          </header>
          <input
            ref={searchBox}
            type="search"
            aria-label="Tìm phiên đã tắt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={200}
            placeholder="Tìm theo thư mục, tên, mã phiên…"
            className="rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text"
          />
          <ul ref={list} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="stopped-history-list">
            {history.items.map((node) => <StoppedHistoryRow key={node.id} node={node} now={now} onOpen={onOpen} />)}
            {!loading && error === null && history.items.length === 0 && (
              <li className="px-2 py-6 text-center text-text-muted">{searching ? 'Không có phiên nào khớp.' : 'Chưa có phiên nào đã tắt.'}</li>
            )}
            <li ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
          </ul>
          {error !== null && (
            <p role="alert" className="flex items-center gap-2 rounded-(--company-radius-sm) bg-warning/12 px-2 py-1 text-2xs text-warning">
              <span className="min-w-0 flex-1">{error}</span>
              <CompanyButton type="button" size="sm" onClick={() => void load(history.nextCursor)}>Thử lại</CompanyButton>
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-2xs text-text-muted">
            <span>{loading ? 'Đang tải…' : history.nextCursor === undefined ? 'Đã hết danh sách.' : ''}</span>
            {history.nextCursor !== undefined && !loading && error === null && (
              <CompanyButton type="button" size="sm" onClick={() => void load(history.nextCursor)}>Tải thêm</CompanyButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

function StoppedHistoryRow({ node, now, onOpen }: { node: ProjectTreeNode; now: number; onOpen: (node: ProjectTreeNode) => void }) {
  const code = sessionCode(node);
  const folder = folderName(node.path);
  return (
    <li>
      <button
        type="button"
        data-testid="stopped-history-row"
        onClick={() => onOpen(node)}
        className="touch-target flex w-full min-w-0 items-center gap-2 rounded px-2 text-left hover:bg-hover"
      >
        <SessionFace mood={sessionFaceMood(node)} hue={sessionFaceHue(node.sessionId ?? node.id)} size="sm" />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-text">{sessionDisplayName(node)}</span>
          {folder !== undefined && <span className="block truncate text-2xs text-text-muted" title={node.path}>📁 {folder}</span>}
        </span>
        {code !== null && <span className="shrink-0 font-mono text-2xs text-text-muted" title={`Mã phiên ${code.full}`}>#{code.short}</span>}
        <UnfinishedMark node={node} count />
        <span className="shrink-0 text-2xs text-text-muted">{stoppedLabel(node, now)}</span>
      </button>
    </li>
  );
}
