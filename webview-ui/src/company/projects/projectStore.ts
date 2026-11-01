import { useSyncExternalStore } from 'react';

import type {
  ClientMessage,
  ProjectBranchCompareMessage,
  ProjectBranchCompareRequestMessage,
  ProjectCommandResultMessage,
  ProjectCommentMessage,
  ProjectDiffMessage,
  ProjectDiffRequestMessage,
  ProjectImageSavedMessage,
  ProjectImageSaveMessage,
  ProjectMergePreviewRequestMessage,
  ProjectMergePreviewResultMessage,
  ProjectNodeCreateMessage,
  ProjectNodeDeleteMessage,
  ProjectNodeMoveMessage,
  ProjectNodeUpdateMessage,
  ProjectSessionProgressMessage,
  ProjectSessionStartMessage,
  ProjectSessionStartResultMessage,
  ProjectSessionStopMessage,
  ProjectSessionWakeMessage,
  ProjectSettingsClearMessage,
  ProjectSettingsMessage,
  ProjectSettingsRequestMessage,
  ProjectSettingsSetMessage,
  ProjectStoppedPageMessage,
  ProjectStoppedRequestMessage,
  ProjectTreeNode,
  ProjectTreeRequestMessage,
  ProjectTreeSnapshotMessage,
  ServerMessage,
} from '../../../../core/src/messages.js';
import { newRequestId as defaultRequestId } from '../companyMessages.js';
import { PROJECT_COMMAND_TIMEOUT_MS } from '../constants.js';

const TIMED_OUT_REASON = 'Máy chủ chưa trả lời. Việc có thể đã xong: tải lại cây để kiểm tra, hoặc thử lại.';

export type ProjectServerMessage =
  | ProjectTreeSnapshotMessage
  | ProjectDiffMessage
  | ProjectSettingsMessage
  | ProjectCommandResultMessage
  | ProjectSessionStartResultMessage
  | ProjectSessionProgressMessage
  | ProjectImageSavedMessage
  | ProjectBranchCompareMessage
  | ProjectStoppedPageMessage
  | ProjectMergePreviewResultMessage;
type ProjectRequest =
  | ProjectTreeRequestMessage
  | ProjectDiffRequestMessage
  | ProjectSettingsRequestMessage
  | ProjectNodeCreateMessage
  | ProjectNodeUpdateMessage
  | ProjectNodeDeleteMessage
  | ProjectNodeMoveMessage
  | ProjectSettingsSetMessage
  | ProjectSettingsClearMessage
  | ProjectSessionStartMessage
  | ProjectSessionStopMessage
  | ProjectSessionWakeMessage
  | ProjectStoppedRequestMessage
  | ProjectImageSaveMessage
  | ProjectCommentMessage
  | ProjectMergePreviewRequestMessage
  | ProjectBranchCompareRequestMessage;

export interface ProjectState {
  nodes: readonly ProjectTreeNode[];
  /** The nodes come from a full snapshot: repos and worktrees are known, not just folders. */
  treeComplete: boolean;
  /** The nodes are the saved tree of an earlier visit; the server's full tree has not arrived yet. */
  treeStale: boolean;
  diff: ProjectDiffMessage | null;
  settings: ProjectSettingsMessage | null;
  pending: Readonly<Record<string, ProjectRequest>>;
  results: Readonly<Record<string, ProjectCommandResultMessage | ProjectSessionStartResultMessage | ProjectBranchCompareMessage | ProjectMergePreviewResultMessage | ProjectImageSavedMessage | ProjectStoppedPageMessage>>;
  errors: Readonly<Record<string, string>>;
  /** The stages each pending session start has entered, in order; cleared when its result arrives. */
  progress: Readonly<Record<string, readonly ProjectSessionProgressMessage['stage'][]>>;
}
export interface ProjectStoreOptions {
  send: (message: ClientMessage) => void;
  newRequestId?: () => string;
  /** The full tree saved by an earlier visit: shown, marked stale, until the server's full tree replaces it. */
  restoreNodes?: readonly ProjectTreeNode[];
  /** Called with every full tree the server sends. */
  saveNodes?: (nodes: readonly ProjectTreeNode[]) => void;
}
export interface ProjectStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ProjectState;
  accept: (message: ServerMessage) => void;
  requestTree: () => string;
  requestDiff: (input: Omit<ProjectDiffRequestMessage, 'type' | 'requestId'>) => string;
  requestSettings: (nodeId?: string) => string;
  createNode: (input: Omit<ProjectNodeCreateMessage, 'type' | 'requestId'>) => string;
  updateNode: (input: Omit<ProjectNodeUpdateMessage, 'type' | 'requestId'>) => string;
  deleteNode: (nodeId: string) => string;
  moveNode: (input: Omit<ProjectNodeMoveMessage, 'type' | 'requestId'>) => string;
  setSetting: (input: Omit<ProjectSettingsSetMessage, 'type' | 'requestId'>) => string;
  clearSetting: (input: Omit<ProjectSettingsClearMessage, 'type' | 'requestId'>) => string;
  startSession: (input: Omit<ProjectSessionStartMessage, 'type' | 'requestId'>) => string;
  /** Stops a live ledger session: its process tree ends. */
  stopSession: (sessionId: string) => string;
  /** Reopens a session that exited lately in a new herdr tab resuming its transcript, the prompt typed into it. */
  wakeSession: (sessionId: string, prompt: string) => string;
  /** Asks for one page of every session that stopped, newest first; `cursor` is the previous page's `nextCursor`. */
  requestStopped: (input: Omit<ProjectStoppedRequestMessage, 'type' | 'requestId'>) => string;
  /** Saves an image from the prompt box; its result is `projectImageSaved` with the file's path. */
  saveImage: (input: Omit<ProjectImageSaveMessage, 'type' | 'requestId'>) => string;
  sendComment: (input: Omit<ProjectCommentMessage, 'type' | 'requestId'>) => string;
  previewMerge: (input: Omit<ProjectMergePreviewRequestMessage, 'type' | 'requestId'>) => string;
  requestBranchCompare: (input: { repo: string; branchA: string; branchB: string }) => string;
}

/** The nodes without `rootId` and everything below it. */
function withoutSubtree(nodes: readonly ProjectTreeNode[], rootId: string): readonly ProjectTreeNode[] {
  const gone = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId !== undefined && gone.has(node.parentId) && !gone.has(node.id)) { gone.add(node.id); grew = true; }
    }
  }
  return nodes.filter((node) => !gone.has(node.id));
}

export function isProjectServerMessage(message: ServerMessage): message is ProjectServerMessage {
  return message.type === 'projectTreeSnapshot' || message.type === 'projectDiff' || message.type === 'projectSettings' || message.type === 'projectCommandResult' || message.type === 'projectSessionStartResult' || message.type === 'projectSessionProgress' || message.type === 'projectMergePreviewResult' || message.type === 'projectBranchCompare' || message.type === 'projectImageSaved' || message.type === 'projectStoppedPage';
}

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  const requestId = options.newRequestId ?? defaultRequestId;
  const restored = options.restoreNodes ?? [];
  let state: ProjectState = { nodes: restored, treeComplete: restored.length > 0, treeStale: restored.length > 0, diff: null, settings: null, pending: {}, results: {}, errors: {}, progress: {} };
  const listeners = new Set<() => void>();
  const latest = new Map<string, string>();
  const commit = (next: ProjectState) => { if (next === state) return; state = next; for (const listener of listeners) listener(); };
  function transmit<T extends ProjectRequest>(request: T, key: string): string {
    const pending = { ...state.pending };
    const progress = { ...state.progress };
    const prior = latest.get(key);
    if (prior !== undefined) { delete pending[prior]; delete progress[prior]; }
    pending[request.requestId] = request;
    latest.set(key, request.requestId);
    commit({ ...state, pending, progress, errors: { ...state.errors, [key]: '' } });
    try { options.send(request); } catch (error) {
      const nextPending = { ...state.pending }; delete nextPending[request.requestId];
      const errors = { ...state.errors, [key]: error instanceof Error ? error.message : String(error) };
      commit({ ...state, pending: nextPending, errors });
      return request.requestId;
    }
    // A write the server never answers would hang its waiter and hide the failure: report it as failed instead.
    if (key.startsWith('command:')) {
      setTimeout(() => {
        if (latest.get(key) !== request.requestId || state.pending[request.requestId] === undefined) return;
        const nextPending = { ...state.pending }; delete nextPending[request.requestId]; latest.delete(key);
        commit({ ...state, pending: nextPending, errors: { ...state.errors, [key]: TIMED_OUT_REASON } });
      }, PROJECT_COMMAND_TIMEOUT_MS);
    }
    return request.requestId;
  }
  function accept(message: ServerMessage): void {
    // A read-only connection is never sent a tree: the saved one would show forever as "loading", so forget it.
    if (message.type === 'officeAccess' && message.readOnly && state.treeStale) {
      commit({ ...state, nodes: [], treeComplete: false, treeStale: false });
      options.saveNodes?.([]);
      return;
    }
    if (!isProjectServerMessage(message)) return;
    // The tree is pushed unasked (sessions start and stop) and may come twice per
    // request (quick, then full): every snapshot is the latest state.
    if (message.type === 'projectTreeSnapshot') {
      const pending = { ...state.pending };
      delete pending[message.requestId];
      if (latest.get('tree') === message.requestId) latest.delete('tree');
      // A quick snapshot after a full one would hide repos for a moment: keep the full nodes.
      if (message.partial === true && state.treeComplete) commit({ ...state, pending });
      else {
        commit({ ...state, nodes: message.nodes, treeComplete: message.partial !== true, treeStale: false, pending });
        if (message.partial !== true) options.saveNodes?.(message.nodes);
      }
      return;
    }
    const request = state.pending[message.requestId];
    if (request === undefined) return;
    if (message.type === 'projectSessionProgress') {
      commit({ ...state, progress: { ...state.progress, [message.requestId]: [...(state.progress[message.requestId] ?? []), message.stage] } });
      return;
    }
    const key = latestKey(request);
    if (latest.get(key) !== message.requestId) return;
    const pending = { ...state.pending }; delete pending[message.requestId]; latest.delete(key);
    const errors = { ...state.errors };
    const progress = { ...state.progress }; delete progress[message.requestId];
    if ('reason' in message && message.reason) errors[key] = message.reason; else delete errors[key];
    // A confirmed delete leaves the tree at once: the quick snapshot that follows is ignored once a full tree is held.
    if (message.type === 'projectCommandResult' && message.command === 'delete' && message.ok && message.nodeId !== undefined) {
      commit({ ...state, nodes: withoutSubtree(state.nodes, message.nodeId), results: { ...state.results, [message.requestId]: message }, pending, errors, progress });
    } else if (message.type === 'projectDiff') commit({ ...state, diff: message, pending, errors, progress });
    else if (message.type === 'projectSettings') commit({ ...state, settings: message, pending, errors, progress });
    else commit({ ...state, results: { ...state.results, [message.requestId]: message }, pending, errors, progress });
  }
  function latestKey(request: ProjectRequest): string {
    switch (request.type) {
      case 'projectTreeRequest': return 'tree';
      case 'projectDiffRequest': return `diff:${request.checkout}:${request.scope}:${request.sha}`;
      case 'projectSettingsRequest': return `settings:${request.nodeId ?? ''}`;
      case 'projectNodeCreate': return 'command:create';
      case 'projectNodeUpdate': return `command:update:${request.nodeId}`;
      case 'projectNodeDelete': return `command:delete:${request.nodeId}`;
      case 'projectNodeMove': return `command:move:${request.nodeId}`;
      case 'projectSettingsSet': return `command:settingsSet:${request.nodeId}:${request.field}`;
      case 'projectSettingsClear': return `command:settingsClear:${request.nodeId}:${request.field}`;
      case 'projectSessionStart': return 'sessionStart';
      case 'projectSessionStop': return `command:stop:${request.sessionId}`;
      case 'projectSessionWake': return `command:wake:${request.sessionId}`;
      case 'projectStoppedRequest': return `command:stopped:${request.query ?? ''}:${request.cursor ?? ''}`;
      case 'projectImageSave': return `image:${request.requestId}`;
      case 'projectComment': return `comment:${request.requestId}`;
      case 'projectMergePreviewRequest': return `merge:${request.repo}:${request.branchA}:${request.branchB}`;
      case 'projectBranchCompareRequest': return `compare:${request.repo}:${request.branchA}:${request.branchB}`;
    }
  }
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state, accept,
    requestTree: () => transmit({ type: 'projectTreeRequest', requestId: requestId() }, 'tree'),
    requestDiff: (input) => { const req = { ...input, type: 'projectDiffRequest' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    requestSettings: (nodeId) => { const req = { type: 'projectSettingsRequest' as const, requestId: requestId(), ...(nodeId === undefined ? {} : { nodeId }) }; return transmit(req, latestKey(req)); },
    createNode: (input) => { const req = { ...input, type: 'projectNodeCreate' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    updateNode: (input) => { const req = { ...input, type: 'projectNodeUpdate' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    deleteNode: (nodeId) => { const req = { type: 'projectNodeDelete' as const, requestId: requestId(), nodeId }; return transmit(req, latestKey(req)); },
    moveNode: (input) => { const req = { ...input, type: 'projectNodeMove' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    setSetting: (input) => { const req = { ...input, type: 'projectSettingsSet' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    startSession: (input) => { const req = { ...input, type: 'projectSessionStart' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    stopSession: (sessionId) => { const req = { type: 'projectSessionStop' as const, requestId: requestId(), sessionId }; return transmit(req, latestKey(req)); },
    wakeSession: (sessionId, prompt) => {
      const req = { type: 'projectSessionWake' as const, requestId: requestId(), sessionId, ...(prompt === '' ? {} : { prompt }) };
      return transmit(req, latestKey(req));
    },
    requestStopped: (input) => { const req = { ...input, type: 'projectStoppedRequest' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    saveImage: (input) => { const req = { ...input, type: 'projectImageSave' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    sendComment: (input) => { const req = { ...input, type: 'projectComment' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    previewMerge: (input) => { const req = { ...input, type: 'projectMergePreviewRequest' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    requestBranchCompare: (input) => { const req = { ...input, type: 'projectBranchCompareRequest' as const, requestId: requestId() }; return transmit(req, latestKey(req)); },
    clearSetting: (input) => {
      const req = { ...input, type: 'projectSettingsClear' as const, requestId: requestId() };
      return transmit(req, latestKey(req));
    },
  };
}

/** How a create ended: made (with the new node's id when the server named it), refused and why, or replaced by a newer create. */
export type ProjectCreateOutcome = { readonly nodeId: string | undefined } | { readonly refusal: string } | { readonly superseded: true };

/** Where a woken session runs now: a herdr pane, or a board chat in its board folder. */
export type ProjectWakeTarget = { readonly paneId: string } | { readonly boardSessionId: string; readonly folder: string };

/** How a wake ended: where the session runs now, or why the server refused. */
export type ProjectWakeOutcome = { readonly target: ProjectWakeTarget } | { readonly refusal: string } | { readonly superseded: true };

/**
 * Waits until the command `requestId` is answered (or failed to send). A command that a newer one
 * of the same key replaced before its answer came has no result of its own: it says nothing, the
 * newer one reports. Executor form: the ES2022 lib has no Promise.withResolvers.
 */
function waitForProjectCommand(
  store: ProjectStore,
  requestId: string,
  key: string,
): Promise<{ readonly result: ProjectCommandResultMessage } | { readonly refusal: string } | { readonly superseded: true }> {
  return new Promise((resolve) => {
    const settle = (): void => {
      const state = store.getSnapshot();
      if (state.pending[requestId] !== undefined) return;
      unsubscribe();
      const result = state.results[requestId];
      if (result?.type === 'projectCommandResult' && result.ok) {
        resolve({ result });
        return;
      }
      const reason = (result?.type === 'projectCommandResult' ? result.reason : undefined) || state.errors[key];
      resolve(reason ? { refusal: reason } : { superseded: true });
    };
    const unsubscribe = store.subscribe(settle);
    settle();
  });
}

export async function waitForProjectCreate(store: ProjectStore, requestId: string): Promise<ProjectCreateOutcome> {
  const outcome = await waitForProjectCommand(store, requestId, 'command:create');
  return 'result' in outcome ? { nodeId: outcome.result.nodeId } : outcome;
}

/** How a stopped-sessions page ended: the page, why the server refused, or replaced by a newer identical ask. */
export type ProjectStoppedOutcome = { readonly page: ProjectStoppedPageMessage } | { readonly refusal: string } | { readonly superseded: true };

/** Asks for one page of stopped sessions and waits for its answer (or its failure to send or time out). */
export function fetchStoppedPage(store: ProjectStore, input: Omit<ProjectStoppedRequestMessage, 'type' | 'requestId'>): Promise<ProjectStoppedOutcome> {
  const requestId = store.requestStopped(input);
  const key = `command:stopped:${input.query ?? ''}:${input.cursor ?? ''}`;
  return new Promise((resolve) => {
    const settle = (): void => {
      const state = store.getSnapshot();
      if (state.pending[requestId] !== undefined) return;
      unsubscribe();
      const result = state.results[requestId];
      if (result?.type === 'projectStoppedPage' && result.ok) {
        resolve({ page: result });
        return;
      }
      const reason = (result?.type === 'projectStoppedPage' ? result.reason : undefined) || state.errors[key];
      resolve(reason ? { refusal: reason } : { superseded: true });
    };
    const unsubscribe = store.subscribe(settle);
    settle();
  });
}

export async function waitForProjectWake(store: ProjectStore, requestId: string, sessionId: string): Promise<ProjectWakeOutcome> {
  const outcome = await waitForProjectCommand(store, requestId, `command:wake:${sessionId}`);
  if (!('result' in outcome)) return outcome;
  const { paneId, boardSessionId, folder } = outcome.result;
  if (boardSessionId !== undefined && folder !== undefined) return { target: { boardSessionId, folder } };
  if (paneId !== undefined) return { target: { paneId } };
  return { refusal: 'Máy chủ không nói phiên đang chạy ở đâu.' };
}

export function useProjectState(store: ProjectStore): ProjectState { return useSyncExternalStore(store.subscribe, store.getSnapshot); }
