import { useSyncExternalStore } from 'react';

import { TRANSPORT_DISCONNECTED_ERROR } from '../../../../core/src/messageDelivery.js';
import type {
  ClientMessage,
  FleetBranchActionMessage,
  FleetCloudCommentSendMessage,
  FleetCommandResultMessage,
  FleetDiffMessage,
  FleetDiffRequestMessage,
  FleetLavishOpenedMessage,
  FleetLavishOpenMessage,
  FleetMachineWakeMessage,
  FleetPullRequest,
  FleetRequestMessage,
  FleetSnapshotMessage,
  FleetTaskCleanedMessage,
  FleetTaskCleanMessage,
  FleetTaskCreatedMessage,
  FleetTaskCreateMessage,
  FleetTerminalOpenedMessage,
  FleetTerminalOpenMessage,
  ProjectCommentMessage,
  ServerMessage,
} from '../../../../core/src/messages.js';
import { newRequestId as defaultRequestId } from '../companyMessages.js';

export type FleetServerMessage =
  | FleetSnapshotMessage
  | FleetCommandResultMessage
  | FleetTerminalOpenedMessage
  | FleetTaskCreatedMessage
  | FleetTaskCleanedMessage
  | FleetLavishOpenedMessage
  | FleetDiffMessage;

/** A cloud tmux session the board is showing in its terminal panel. */
export interface FleetTerminal {
  readonly machine: string;
  readonly session: string;
  readonly terminalId: number;
}

/** One in-flight action (open a terminal / create a task); only the latest one is tracked. */
export interface FleetAction {
  readonly requestId: string;
  readonly kind: 'terminal' | 'task' | 'clean' | 'wake' | 'lavish' | 'diff' | 'comment' | 'branch';
  readonly machine: string;
  readonly session: string;
}
export type FleetSend = (message: ClientMessage) => void;

export interface FleetState {
  readonly privileged: boolean | null;
  readonly connection: number;
  readonly probeRequestId: string | null;
  readonly latestRequestId: string | null;
  readonly snapshot: FleetSnapshotMessage | null;
  readonly error: string | null;
  readonly action: FleetAction | null;
  readonly actionError: string | null;
  readonly terminal: FleetTerminal | null;
  /** Set when a task was created: the machine/session to open next. */
  readonly createdTask: { readonly machine: string; readonly session: string } | null;
  /** Set when the machine removed a task: the board hides it until the machine's reports agree. */
  readonly cleanedTask: { readonly machine: string; readonly session: string } | null;
  /** The last diff the user asked for, shown until closed. */
  readonly diff: Omit<FleetDiffMessage, 'type' | 'requestId'> | null;
}

export interface FleetStoreOptions {
  readonly send: FleetSend;
  readonly newRequestId?: () => string;
}

export interface FleetStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FleetState;
  accept: (message: ServerMessage) => void;
  connect: () => void;
  requestFleet: () => string;
  openTerminal: (machine: string, session: string) => void;
  closeTerminal: () => void;
  createTask: (task: Omit<FleetTaskCreateMessage, 'type' | 'requestId'>) => void;
  /** Removes a task the board started (tmux, worktrees, branch); the machine refuses while it holds unsaved work. */
  cleanTask: (machine: string, session: string) => void;
  /** Starts a machine InstaBox paused; the fleet is asked again once InstaBox accepted it. */
  wakeMachine: (machine: string) => void;
  /** Opens the session in a new browser tab once the board has forwarded a local port to the machine. */
  /** `tab` is opened by the click handler itself (a tab opened later, after the network round trip, is blocked as a popup). */
  openLavish: (machine: string, key: string, tab?: PendingTab | null) => void;
  requestDiff: (machine: string, path: string) => void;
  sendCloudComment: (comment: Omit<FleetCloudCommentSendMessage, 'type' | 'requestId'>) => void;
  runBranchAction: (action: Omit<FleetBranchActionMessage, 'type' | 'requestId'>) => void;
  sendLocalCiFailureComment: (checkout: string, receivingSessionId: string, pr: FleetPullRequest) => void;
  closeDiff: () => void;
}

export interface PendingTab {
  navigate(url: string): void;
  close(): void;
}

export interface FleetStoreEnvironment {
  /** Opens a URL in a new tab; injected so tests do not need a window. */
  readonly openUrl?: (url: string) => void;
}

const NO_CONNECTION_REASON = 'Chưa kết nối tới máy chủ, yêu cầu chưa được gửi.';
const SEND_FAILED_REASON = 'Không gửi được yêu cầu xem Cloud.';

export function createInitialFleetState(): FleetState {
  return {
    privileged: null,
    connection: 0,
    probeRequestId: null,
    latestRequestId: null,
    snapshot: null,
    error: null,
    action: null,
    actionError: null,
    terminal: null,
    createdTask: null,
    cleanedTask: null,
    diff: null,
  };
}

export function isFleetServerMessage(message: ServerMessage): message is FleetServerMessage {
  return (
    message.type === 'fleetSnapshot' ||
    message.type === 'fleetCommandResult' ||
    message.type === 'fleetTerminalOpened' ||
    message.type === 'fleetTaskCreated' ||
    message.type === 'fleetTaskCleaned' ||
    message.type === 'fleetLavishOpened' ||
    message.type === 'fleetDiff'
  );
}

export function createFleetStore(options: FleetStoreOptions & FleetStoreEnvironment): FleetStore {
  const newRequestId = options.newRequestId ?? defaultRequestId;
  const openUrl = options.openUrl ?? ((url: string) => window.open(url, '_blank', 'noopener'));
  let pendingTab: PendingTab | null = null;
  const settleTab = (url: string | null): void => {
    const tab = pendingTab;
    pendingTab = null;
    if (url === null) tab?.close();
    else if (tab) tab.navigate(url);
    else openUrl(url);
  };
  const send = options.send;
  let state = createInitialFleetState();
  const listeners = new Set<() => void>();

  function commit(next: FleetState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function transmit(request: FleetRequestMessage): void {
    commit({ ...state, latestRequestId: request.requestId, error: null });
    try {
      send(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      commit({
        ...state,
        latestRequestId: null,
        error: detail === TRANSPORT_DISCONNECTED_ERROR ? NO_CONNECTION_REASON : SEND_FAILED_REASON,
      });
    }
  }

  function act(
    request: FleetTerminalOpenMessage | FleetTaskCreateMessage | FleetTaskCleanMessage | FleetMachineWakeMessage | FleetLavishOpenMessage | FleetDiffRequestMessage | FleetCloudCommentSendMessage | FleetBranchActionMessage,
    kind: FleetAction['kind'],
    session: string,
  ): void {
    // One action at a time: a double click must not create two cloud tasks.
    if (state.action !== null) return;
    commit({
      ...state,
      action: {
        requestId: request.requestId,
        kind,
        machine: request.type === 'fleetBranchAction' ? 'local' : request.machine,
        session,
      },
      actionError: null,
      createdTask: null,
      cleanedTask: null,
    });
    try {
      send(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (kind === 'lavish') settleTab(null);
      commit({ ...state, action: null, actionError: detail === TRANSPORT_DISCONNECTED_ERROR ? NO_CONNECTION_REASON : SEND_FAILED_REASON });
    }
  }

  function acceptAction(message: FleetServerMessage): boolean {
    const action = state.action;
    if (action === null || message.requestId !== action.requestId) return false;
    if (message.type === 'fleetTerminalOpened') {
      commit({ ...state, action: null, terminal: { machine: action.machine, session: action.session, terminalId: message.terminalId } });
    } else if (message.type === 'fleetLavishOpened') {
      commit({ ...state, action: null });
      settleTab(message.url);
    } else if (message.type === 'fleetDiff') {
      commit({ ...state, action: null, diff: { machine: message.machine, path: message.path, text: message.text, truncated: message.truncated } });
    } else if (message.type === 'fleetTaskCreated') {
      commit({ ...state, action: null, createdTask: { machine: message.machine, session: message.session } });
    } else if (message.type === 'fleetTaskCleaned') {
      commit({ ...state, action: null, cleanedTask: { machine: message.machine, session: message.session } });
    } else if (message.type === 'fleetCommandResult') {
      if (action.kind === 'lavish') settleTab(null);
      commit({ ...state, action: null, actionError: message.ok ? null : message.reason ?? SEND_FAILED_REASON });
      if ((action.kind === 'branch' || action.kind === 'wake') && message.ok) {
        transmit({ type: 'fleetRequest', requestId: newRequestId() });
      }
    }
    return true;
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    accept: (message) => {
      if (!isFleetServerMessage(message)) return;
      if (acceptAction(message)) return;
      const isSnapshotUpdate =
        message.type === 'fleetSnapshot' &&
        state.latestRequestId === null &&
        message.requestId === state.snapshot?.requestId;
      if (message.requestId !== state.latestRequestId && !isSnapshotUpdate) return;
      if (message.type === 'fleetSnapshot') {
        commit({
          ...state,
          privileged: true,
          probeRequestId: null,
          latestRequestId: null,
          snapshot: message,
          error: null,
        });
        return;
      }
      if (message.type !== 'fleetCommandResult') return;
      const isProbe = message.requestId === state.probeRequestId;
      commit({
        ...state,
        privileged: isProbe ? message.code !== 'forbidden' : state.privileged,
        probeRequestId: isProbe ? null : state.probeRequestId,
        latestRequestId: null,
        error: message.reason ?? SEND_FAILED_REASON,
      });
    },
    connect: () => {
      const requestId = newRequestId();
      commit({
        ...state,
        connection: state.connection + 1,
        probeRequestId: requestId,
        latestRequestId: requestId,
        error: null,
      });
      transmit({ type: 'fleetRequest', requestId });
    },
    requestFleet: () => {
      const requestId = newRequestId();
      transmit({ type: 'fleetRequest', requestId });
      return requestId;
    },
    openTerminal: (machine, session) => {
      act({ type: 'fleetTerminalOpen', requestId: newRequestId(), machine, session }, 'terminal', session);
    },
    closeTerminal: () => commit({ ...state, terminal: null }),
    createTask: (task) => {
      act({ type: 'fleetTaskCreate', requestId: newRequestId(), ...task }, 'task', task.slug);
    },
    cleanTask: (machine, session) => {
      act({ type: 'fleetTaskClean', requestId: newRequestId(), machine, session }, 'clean', session);
    },
    wakeMachine: (machine) => {
      act({ type: 'fleetMachineWake', requestId: newRequestId(), machine }, 'wake', machine);
    },
    openLavish: (machine, key, tab) => {
      if (state.action !== null) {
        tab?.close();
        return;
      }
      pendingTab = tab ?? null;
      act({ type: 'fleetLavishOpen', requestId: newRequestId(), machine, key }, 'lavish', key);
    },
    requestDiff: (machine, path) => {
      act({ type: 'fleetDiffRequest', requestId: newRequestId(), machine, path }, 'diff', path);
    },
    sendCloudComment: (comment) => {
      act({ type: 'fleetCloudCommentSend', requestId: newRequestId(), ...comment }, 'comment', comment.session);
    },
    runBranchAction: (action) => {
      act({ type: 'fleetBranchAction', requestId: newRequestId(), ...action }, 'branch', action.branch);
    },
    sendLocalCiFailureComment: (checkout, receivingSessionId, pr) => {
      if (state.action !== null) return;
      try {
        send({
          type: 'projectComment',
          requestId: newRequestId(),
          checkout,
          receivingSessionId,
          file: `CI / PR #${pr.number}`,
          line: 1,
          snippet: pr.failedChecks.join('\n').slice(0, 1200),
          content: `CI đỏ · PR #${pr.number} · ${pr.url}. Hãy xử lý lỗi CI; không tự gộp.`,
        } satisfies ProjectCommentMessage);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        commit({ ...state, actionError: detail === TRANSPORT_DISCONNECTED_ERROR ? NO_CONNECTION_REASON : SEND_FAILED_REASON });
      }
    },
    closeDiff: () => commit({ ...state, diff: null }),
  };
}

export function useFleetState(store: FleetStore): FleetState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
