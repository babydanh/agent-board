/**
 * shareStore: the board's view of its view-only share links. The server owns them; this store
 * sends the three commands and keeps the list and the answer to the latest one.
 */

import { useSyncExternalStore } from 'react';

import type { ClientMessage, ServerMessage, ShareInfo } from '../../../../core/src/messages.js';
import { newRequestId as defaultRequestId } from '../companyMessages.js';

const SEND_FAILED_REASON = 'Không gửi được yêu cầu share. Kiểm tra kết nối rồi thử lại.';

export interface ShareState {
  readonly shares: readonly ShareInfo[];
  /** A command is waiting for its answer. */
  readonly busy: boolean;
  readonly error: string | null;
  /** The link the last create made; the dialog shows it until reset. */
  readonly createdToken: string | null;
}

export interface ShareStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ShareState;
  accept(message: ServerMessage): void;
  create(input: { terminalId: number; label: string; ttlMinutes?: number }): void;
  revoke(token: string): void;
  refresh(): void;
  /** Forgets the last created link and error, keeping the list. */
  reset(): void;
}

export function createShareStore(options: {
  send: (message: ClientMessage) => void;
  newRequestId?: () => string;
}): ShareStore {
  const newRequestId = options.newRequestId ?? defaultRequestId;
  const listeners = new Set<() => void>();
  let state: ShareState = { shares: [], busy: false, error: null, createdToken: null };
  let latest: string | null = null;

  const commit = (next: ShareState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  const transmit = (build: (requestId: string) => ClientMessage): void => {
    const requestId = newRequestId();
    latest = requestId;
    commit({ ...state, busy: true, error: null, createdToken: null });
    try {
      options.send(build(requestId));
    } catch {
      latest = null;
      commit({ ...state, busy: false, error: SEND_FAILED_REASON });
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    accept: (message) => {
      if (message.type !== 'shareResult' || message.requestId !== latest) return;
      latest = null;
      commit({
        shares: message.shares,
        busy: false,
        error: message.ok ? null : (message.reason ?? SEND_FAILED_REASON),
        createdToken: message.ok && message.token !== undefined ? message.token : null,
      });
    },
    create: ({ terminalId, label, ttlMinutes }) =>
      transmit((requestId) => ({
        type: 'shareCreate',
        requestId,
        terminalId,
        label,
        ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
      })),
    revoke: (token) => transmit((requestId) => ({ type: 'shareRevoke', requestId, token })),
    refresh: () => transmit((requestId) => ({ type: 'shareListRequest', requestId })),
    reset: () => commit({ ...state, error: null, createdToken: null }),
  };
}

export function useShareState(store: ShareStore): ShareState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
