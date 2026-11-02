import { useSyncExternalStore } from 'react';

import { TRANSPORT_DISCONNECTED_ERROR } from '../../../../core/src/messageDelivery.js';
import type {
  ClientMessage,
  FleetBranchActionMessage,
  FleetCloudCommentSendMessage,
  FleetCommandHistoryMessage,
  FleetCommandHistoryRequestMessage,
  FleetCommandQueueMessage,
  FleetCommandResultMessage,
  FleetCommandRow,
  FleetDiffMessage,
  FleetDiffRequestMessage,
  FleetHistoryMessage,
  FleetHistoryRequestMessage,
  FleetLavishDeleteMessage,
  FleetLavishOpenedMessage,
  FleetLavishOpenMessage,
  FleetMachineWakeMessage,
  FleetPullRequest,
  FleetRequestMessage,
  FleetSessionRestartMessage,
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
import { FLEET_ACTION_TIMEOUT_MS } from '../constants.js';

export type FleetServerMessage =
  | FleetSnapshotMessage
  | FleetCommandResultMessage
  | FleetTerminalOpenedMessage
  | FleetTaskCreatedMessage
  | FleetTaskCleanedMessage
  | FleetLavishOpenedMessage
  | FleetDiffMessage
  | FleetHistoryMessage
  | FleetCommandHistoryMessage;

/** A cloud tmux session the board is showing in its terminal panel. */
export interface FleetTerminal {
  readonly machine: string;
  readonly session: string;
  readonly terminalId: number;
}

/** One in-flight action (open a terminal / create a task); only the latest one is tracked. */
export interface FleetAction {
  readonly requestId: string;
  readonly kind: 'terminal' | 'task' | 'clean' | 'wake' | 'lavish' | 'lavishDelete' | 'restart' | 'diff' | 'history' | 'comment' | 'branch' | 'command' | 'commands';
  readonly machine: string;
  readonly session: string;
  /** Epoch ms the request was sent; the board shows the wait from it. */
  readonly startedAt: number;
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
  /** One session's scrollback fetched once, scrolled locally (no network round trip per step) until closed. */
  readonly history: Omit<FleetHistoryMessage, 'type' | 'requestId'> | null;
  /** The hub's recent remote commands, once asked for; null until then. */
  readonly commands: readonly FleetCommandRow[] | null;
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
  /** Drops the attached terminal and opens a fresh one on the same session (its board-side process is gone). */
  reopenTerminal: () => void;
  createTask: (task: Omit<FleetTaskCreateMessage, 'type' | 'requestId'>) => void;
  /** Stops waiting for the action in flight (its late answer is ignored) so the buttons work again. */
  cancelAction: () => void;
  /** Removes a task the board started (tmux, worktrees, branch); the machine refuses while it holds unsaved work. */
  cleanTask: (machine: string, session: string, pushFirst?: boolean) => void;
  /** Starts a machine InstaBox paused; the fleet is asked again once InstaBox accepted it. */
  wakeMachine: (machine: string) => void;
  /** Opens the session in a new browser tab once the board has forwarded a local port to the machine. */
  /** `tab` is opened by the click handler itself (a tab opened later, after the network round trip, is blocked as a popup). */
  openLavish: (machine: string, key: string, tab?: PendingTab | null) => void;
  /** Deletes one Lavish page on the machine (ends its session, removes the file); the agent can write it again. */
  deleteLavish: (machine: string, key: string) => void;
  /** Restarts the session's Claude on the same conversation (claude --resume); the machine refuses while Claude looks busy. */
  restartSession: (machine: string, session: string) => void;
  requestDiff: (machine: string, path: string) => void;
  requestHistory: (machine: string, session: string) => void;
  closeHistory: () => void;
  sendCloudComment: (comment: Omit<FleetCloudCommentSendMessage, 'type' | 'requestId'>) => void;
  runBranchAction: (action: Omit<FleetBranchActionMessage, 'type' | 'requestId'>) => void;
  sendLocalCiFailureComment: (checkout: string, receivingSessionId: string, pr: FleetPullRequest) => void;
  /** Queues one fixed remote command through the board's command key; the history is asked again once the hub accepted it. */
  queueCommand: (command: Omit<FleetCommandQueueMessage, 'type' | 'requestId'>) => void;
  requestCommands: () => void;
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

const TIMED_OUT_REASON = 'Máy chủ chưa trả lời. Việc có thể vẫn đang chạy trên máy: làm mới danh sách để kiểm tra, hoặc thử lại.';
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
    history: null,
    commands: null,
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
    message.type === 'fleetDiff' ||
    message.type === 'fleetHistory' ||
    message.type === 'fleetCommandHistory'
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

  let actionTimer: ReturnType<typeof setTimeout> | null = null;

  function commit(next: FleetState): void {
    if (next === state) return;
    state = next;
    if (state.action === null && actionTimer !== null) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
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
    request: FleetTerminalOpenMessage | FleetTaskCreateMessage | FleetTaskCleanMessage | FleetMachineWakeMessage | FleetLavishOpenMessage | FleetLavishDeleteMessage | FleetSessionRestartMessage | FleetDiffRequestMessage | FleetHistoryRequestMessage | FleetCloudCommentSendMessage | FleetBranchActionMessage | FleetCommandQueueMessage | FleetCommandHistoryRequestMessage,
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
        machine: request.type === 'fleetBranchAction' ? 'local' : request.type === 'fleetCommandHistoryRequest' ? 'hub' : request.machine,
        session,
        startedAt: Date.now(),
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
      return;
    }
    // A machine that never answers must not lock every button for good: only a reconnect used to clear it.
    const requestId = request.requestId;
    actionTimer = setTimeout(() => {
      if (state.action?.requestId !== requestId) return;
      if (state.action.kind === 'lavish') settleTab(null);
      commit({ ...state, action: null, actionError: TIMED_OUT_REASON });
    }, FLEET_ACTION_TIMEOUT_MS[kind]);
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
    } else if (message.type === 'fleetHistory') {
      commit({ ...state, action: null, history: { machine: message.machine, session: message.session, text: message.text, truncated: message.truncated } });
    } else if (message.type === 'fleetCommandHistory') {
      commit({ ...state, action: null, commands: message.commands });
    } else if (message.type === 'fleetTaskCreated') {
      commit({ ...state, action: null, createdTask: { machine: message.machine, session: message.session } });
    } else if (message.type === 'fleetTaskCleaned') {
      commit({ ...state, action: null, cleanedTask: { machine: message.machine, session: message.session } });
    } else if (message.type === 'fleetCommandResult') {
      if (action.kind === 'lavish') settleTab(null);
      commit({ ...state, action: null, actionError: message.ok ? null : message.reason ?? SEND_FAILED_REASON });
      if (action.kind === 'command' && message.ok) act({ type: 'fleetCommandHistoryRequest', requestId: newRequestId() }, 'commands', 'lịch sử lệnh');
      if ((action.kind === 'branch' || action.kind === 'wake' || action.kind === 'lavishDelete') && message.ok) {
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
      // A (re)connect means the old socket is gone and with it the answer to any action still waiting; keeping it would lock every button.
      if (state.action?.kind === 'lavish') settleTab(null);
      commit({
        ...state,
        connection: state.connection + 1,
        probeRequestId: requestId,
        latestRequestId: requestId,
        error: null,
        action: null,
        actionError: null,
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
    cancelAction: () => {
      if (state.action === null) return;
      if (state.action.kind === 'lavish') settleTab(null);
      commit({ ...state, action: null, actionError: null });
    },
    closeTerminal: () => commit({ ...state, terminal: null }),
    reopenTerminal: () => {
      const dead = state.terminal;
      // Another action running owns the lock: dropping the terminal now would leave nothing to reopen it.
      if (dead === null || state.action !== null) return;
      // The board gives a reopened session the same id, so the old one must leave first or the view would not reconnect.
      commit({ ...state, terminal: null });
      act({ type: 'fleetTerminalOpen', requestId: newRequestId(), machine: dead.machine, session: dead.session }, 'terminal', dead.session);
    },
    createTask: (task) => {
      act({ type: 'fleetTaskCreate', requestId: newRequestId(), ...task }, 'task', task.slug);
    },
    cleanTask: (machine, session, pushFirst = false) => {
      act({ type: 'fleetTaskClean', requestId: newRequestId(), machine, session, ...(pushFirst ? { pushFirst: true } : {}) }, 'clean', session);
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
    deleteLavish: (machine, key) => {
      act({ type: 'fleetLavishDelete', requestId: newRequestId(), machine, key }, 'lavishDelete', key);
    },
    restartSession: (machine, session) => {
      act({ type: 'fleetSessionRestart', requestId: newRequestId(), machine, session }, 'restart', session);
    },
    requestHistory: (machine, session) => {
      act({ type: 'fleetHistoryRequest', requestId: newRequestId(), machine, session }, 'history', session);
    },
    closeHistory: () => commit({ ...state, history: null }),
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
    queueCommand: (command) => {
      act({ type: 'fleetCommandQueue', requestId: newRequestId(), ...command }, 'command', command.verb);
    },
    requestCommands: () => {
      act({ type: 'fleetCommandHistoryRequest', requestId: newRequestId() }, 'commands', 'lịch sử lệnh');
    },
    closeDiff: () => commit({ ...state, diff: null }),
  };
}

export function useFleetState(store: FleetStore): FleetState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
