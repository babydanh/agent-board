import { statSync } from 'node:fs';

import type {
  ProjectBranchCompareRequestMessage,
  ProjectCommandResultMessage,
  ProjectCommentMessage,
  ProjectDiffRequestMessage,
  ProjectImageSaveMessage,
  ProjectMergePreviewRequestMessage,
  ProjectNodeCreateMessage,
  ProjectNodeDeleteMessage,
  ProjectNodeMoveMessage,
  ProjectNodeUpdateMessage,
  ProjectSessionStartMessage,
  ProjectSettingsClearMessage,
  ProjectSettingsRequestMessage,
  ProjectSettingsSetMessage,
  ServerMessage,
} from '../../../core/src/messages.js';
import { killClaudeTree } from '../company/claudeCode/claudeProcess.js';
import { LibraryUserError } from '../library/libraryError.js';
import type { AgentState } from '../types.js';
import { getProjectBranchCompare } from './branchCompare.js';
import { sendProjectComment } from './comments.js';
import { getProjectDiff } from './diff.js';
import { savePromptImage } from './imageSave.js';
import { previewProjectMerge } from './mergePreview.js';
import { startProjectSession } from './newSession.js';
import { type ProjectNode, type ProjectState, ProjectStore } from './projectStore.js';
import {
  buildProjectTreeSnapshot,
  forgetChangeCounts,
  type HerdrProjectSession,
  type ProjectTreeOptions,
  type ProjectTreeSnapshot,
  withDeadProcessesEnded,
} from './projectTree.js';
import type { ProjectModuleDeps, ProjectServices } from './services.js';
import { processAlive, stopLedgerSession } from './sessionStop.js';
import { wakeEndedSession } from './sessionWake.js';
import { clearProjectSettings, getProjectSettings, refreshProjectSettings, setProjectSettings } from './settingsLayers.js';

const FALLBACK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
const REQUEST_TYPES: Record<string, true> = {
  projectTreeRequest: true,
  projectNodeCreate: true,
  projectNodeUpdate: true,
  projectNodeDelete: true,
  projectNodeMove: true,
  projectDiffRequest: true,
  projectComment: true,
  projectSettingsRequest: true,
  projectSettingsSet: true,
  projectSettingsClear: true,
  projectSessionStart: true,
  projectSessionStop: true,
  projectSessionWake: true,
  projectImageSave: true,
  projectMergePreviewRequest: true,
  projectBranchCompareRequest: true,
};
let defaultStore: ProjectStore | undefined;

function projectStoreFor(context: ProjectCommandContext): ProjectStore {
  if (context.store !== undefined) return context.store;
  defaultStore ??= new ProjectStore();
  return defaultStore;
}

export interface ProjectCommandContext {
  readonly privileged: boolean;
  readonly store?: ProjectStore;
  readonly tree?: ProjectTreeOptions;
  readonly agents?: Iterable<AgentState>;
  readonly herdrSessions?: () => readonly HerdrProjectSession[];
  readonly services?: ProjectServices;
  /** Board session behind an omp (native) session id, from the open folders. */
  readonly boardSessionFor?: (nativeSessionId: string) => string | undefined;
}

/** Module deps for one phase-two command; throws a user error when its service is not wired. */
function depsFor<S>(
  store: ProjectStore,
  context: ProjectCommandContext,
  services: S | undefined,
): ProjectModuleDeps<S> {
  if (services === undefined) throw new LibraryUserError('Chức năng chưa được kết nối.');
  return { store, loadTree: () => buildTree(store, context), services };
}

/** Handles project tree, mutations and phase-two commands. Returns false for other messages. */
export function handleProjectMessage(
  msg: Record<string, unknown>,
  send: (message: ServerMessage) => void,
  context: ProjectCommandContext,
): boolean {
  if (typeof msg.type !== 'string' || REQUEST_TYPES[msg.type] !== true) return false;
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : FALLBACK_REQUEST_ID;
  if (!context.privileged) {
    const reason = 'Chỉ kết nối được cấp quyền mới được quản lý Project.';
    if (msg.type === 'projectMergePreviewRequest') {
      send(mergePreviewFailure(msg, requestId, reason));
    } else if (msg.type === 'projectBranchCompareRequest') {
      send(branchCompareFailure(msg, requestId, reason));
    } else {
      send(commandResult(requestId, commandFor(msg.type), false, reason));
    }
    return true;
  }
  void runProjectRequest(msg, requestId, send, context);
  return true;
}

async function runProjectRequest(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: ProjectCommandContext,
): Promise<void> {
  const type = typeof msg.type === 'string' ? msg.type : '';
  const store = projectStoreFor(context);
  try {
    switch (msg.type) {
      case 'projectTreeRequest':
        if (context.tree === undefined) throw new LibraryUserError('Không thể tải cây Project vì dữ liệu phiên chưa được kết nối.');
        await sendTreeSnapshot(requestId, send, store, context, false);
        return;
      case 'projectNodeCreate': {
        const request = msg as unknown as ProjectNodeCreateMessage;
        let nodeId: string;
        if (request.kind === 'project') {
          const project = await store.createProject(request.name);
          nodeId = project.id;
          // A project made from a picked folder holds that folder at once; a folder that cannot be added leaves no empty project.
          if (typeof request.path === 'string') {
            try {
              await store.addFolder(project.id, request.path);
            } catch (error) {
              await store.deleteProject(project.id);
              throw error;
            }
          }
        } else {
          const target = targetForParent(await store.load(), request.parentId);
          if (request.kind === 'folder') {
            if (typeof request.path !== 'string' || request.path.trim() === '') throw new LibraryUserError('Đường dẫn thư mục không hợp lệ.');
            nodeId = (await store.addFolder(target.projectId, request.path, target.groupId)).id;
          } else {
            nodeId = (await store.createGroup(target.projectId, request.name, target.groupId)).id;
          }
        }
        send(commandResult(requestId, 'create', true, '', nodeId));
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectNodeUpdate': {
        const request = msg as unknown as ProjectNodeUpdateMessage;
        const state = await store.load();
        if (state.projects.some((candidate) => candidate.id === request.nodeId)) {
          await store.renameProject(request.nodeId, request.name);
        } else {
          const node = findNode(state.projects.flatMap((project) => project.children), request.nodeId);
          if (node?.type === 'group') await store.renameGroup(request.nodeId, request.name);
          else if (node?.type === 'folder') await store.renameFolder(request.nodeId, request.name);
          else throw new LibraryUserError('Không tìm thấy mục cần đổi tên.');
        }
        send(commandResult(requestId, 'update', true, '', request.nodeId));
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectNodeDelete': {
        const request = msg as unknown as ProjectNodeDeleteMessage;
        const state = await store.load();
        if (state.projects.some((candidate) => candidate.id === request.nodeId)) {
          await store.deleteProject(request.nodeId);
        } else {
          const node = findNode(state.projects.flatMap((project) => project.children), request.nodeId);
          if (node?.type === 'folder') await store.removeFolder(request.nodeId);
          else if (node?.type === 'group') await store.deleteGroup(request.nodeId);
          else throw new LibraryUserError('Không tìm thấy nút cần xóa.');
        }
        send(commandResult(requestId, 'delete', true, '', request.nodeId));
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectNodeMove': {
        const request = msg as unknown as ProjectNodeMoveMessage;
        const state = await store.load();
        if (
          request.parentId === undefined &&
          state.projects.some((project) => project.id === request.nodeId)
        ) {
          await store.moveProject(request.nodeId, request.index ?? state.projects.length - 1);
        } else {
          const target = targetForParent(state, request.parentId);
          await store.moveNode(request.nodeId, target.projectId, target.groupId, request.index);
        }
        send(commandResult(requestId, 'move', true, '', request.nodeId));
        // A folder that changed Project inherits different values: reapply them.
        if (context.services?.settings !== undefined) {
          await refreshProjectSettings(depsFor(store, context, context.services.settings));
        }
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectDiffRequest': {
        const deps = depsFor(store, context, context.services?.diff);
        const result = await getProjectDiff(msg as unknown as ProjectDiffRequestMessage, deps);
        send({ ...result, requestId });
        return;
      }
      case 'projectComment':
        await sendProjectComment(msg as unknown as ProjectCommentMessage, depsFor(store, context, context.services?.comments));
        send(commandResult(requestId, 'comment', true, ''));
        return;
      case 'projectSettingsRequest': {
        const deps = depsFor(store, context, context.services?.settings);
        const result = await getProjectSettings(msg as unknown as ProjectSettingsRequestMessage, deps);
        send({ ...result, requestId });
        return;
      }
      case 'projectSettingsSet':
        await setProjectSettings(msg as unknown as ProjectSettingsSetMessage, depsFor(store, context, context.services?.settings));
        send(commandResult(requestId, 'settingsSet', true, ''));
        return;
      case 'projectSettingsClear':
        await clearProjectSettings(msg as unknown as ProjectSettingsClearMessage, depsFor(store, context, context.services?.settings));
        send(commandResult(requestId, 'settingsClear', true, ''));
        return;
      case 'projectSessionStart': {
        const deps = depsFor(store, context, context.services?.session);
        const result = await startProjectSession(msg as unknown as ProjectSessionStartMessage, deps, (stage) =>
          send({ type: 'projectSessionProgress', requestId, stage }));
        send({ ...result, requestId });
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectSessionStop': {
        if (context.tree === undefined) throw new LibraryUserError('Sổ hoạt động chưa được kết nối.');
        const ledger = context.tree.ledger;
        stopLedgerSession(typeof msg.sessionId === 'string' ? msg.sessionId : '', {
          sessionRows: () => ledger.sessionRows(),
          isAlive: processAlive,
          killTree: (pid) => killClaudeTree(pid),
          selfPid: process.pid,
        });
        send(commandResult(requestId, 'stop', true, ''));
        return;
      }
      case 'projectSessionWake': {
        if (context.tree === undefined) throw new LibraryUserError('Sổ hoạt động chưa được kết nối.');
        const services = context.services?.session;
        if (services === undefined) throw new LibraryUserError('Chức năng chưa được kết nối.');
        const ledger = context.tree.ledger;
        const target = await wakeEndedSession(
          typeof msg.sessionId === 'string' ? msg.sessionId : '',
          typeof msg.prompt === 'string' ? msg.prompt : '',
          {
            // A killed session never wrote its end: its dead process is what says it ended.
            sessionRows: () => withDeadProcessesEnded(ledger.sessionRows(), processAlive),
            ...(services.reopenBoardChat === undefined ? {} : { reopenBoardChat: services.reopenBoardChat }),
            startAgent: (input) => services.startAgent(input),
            findAgent: (name) => services.findAgent(name),
            isDirectory: (folder) => statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true,
          },
        );
        send({ ...commandResult(requestId, 'wake', true, ''), ...target });
        await sendTreeSnapshot(requestId, send, store, context);
        return;
      }
      case 'projectImageSave': {
        const path = await savePromptImage(msg as unknown as ProjectImageSaveMessage);
        send({ type: 'projectImageSaved', requestId, path });
        return;
      }
      case 'projectMergePreviewRequest': {
        const deps = depsFor(store, context, context.services?.mergePreview);
        const result = await previewProjectMerge(msg as unknown as ProjectMergePreviewRequestMessage, deps);
        send({ ...result, requestId });
        return;
      }
      case 'projectBranchCompareRequest': {
        const deps = depsFor(store, context, context.services?.branchCompare);
        const result = await getProjectBranchCompare(msg as unknown as ProjectBranchCompareRequestMessage, deps);
        send({ ...result, requestId });
        return;
      }
    }
  } catch (error) {
    const reason = error instanceof LibraryUserError ? error.message : safeReason(type);
    if (msg.type === 'projectMergePreviewRequest') {
      send(mergePreviewFailure(msg, requestId, reason));
    } else if (msg.type === 'projectBranchCompareRequest') {
      send(branchCompareFailure(msg, requestId, reason));
    } else if (msg.type === 'projectTreeRequest') {
      send(commandResult(requestId, 'create', false, reason));
    } else if (msg.type === 'projectSessionStart') {
      send({ type: 'projectSessionStartResult', requestId, ok: false, reason });
    } else if (msg.type === 'projectSettingsRequest') {
      send({
        type: 'projectSettings', requestId,
        ...(typeof msg.nodeId === 'string' ? { nodeId: msg.nodeId } : {}), values: {}, sources: {},
      });
    } else if (msg.type === 'projectDiffRequest') {
      send({
        type: 'projectDiff', requestId,
        checkout: typeof msg.checkout === 'string' ? msg.checkout : '',
        scope: isDiffScope(msg.scope) ? msg.scope : 'uncommitted', sha: '', files: [], truncated: false, reason,
      });
    } else {
      send(commandResult(requestId, commandFor(type), false, reason, typeof msg.nodeId === 'string' ? msg.nodeId : undefined));
    }
  }
}

/** A tree build runs git across every checkout; sockets refreshing together share one. */
const TREE_REUSE_MS = 3_000;
const treeBuilds = new WeakMap<ProjectStore, { readonly at: number; readonly build: Promise<ProjectTreeSnapshot> }>();

/** How long a tree request waits for the full build before sending the quick one first. */
const QUICK_TREE_WAIT_MS = 300;

function treeOptions(context: ProjectCommandContext): ProjectTreeOptions {
  if (context.tree === undefined) throw new LibraryUserError('Không thể tải cây Project vì dữ liệu phiên chưa được kết nối.');
  return {
    ...context.tree,
    ...(context.agents === undefined ? {} : { agents: context.agents }),
    ...(context.herdrSessions === undefined ? {} : { herdrSessions: context.herdrSessions }),
    ...(context.boardSessionFor === undefined ? {} : { boardSessionFor: context.boardSessionFor }),
  };
}

async function buildTree(store: ProjectStore, context: ProjectCommandContext): Promise<ProjectTreeSnapshot> {
  if (context.tree === undefined) throw new LibraryUserError('Không thể tải cây Project vì dữ liệu phiên chưa được kết nối.');
  const recent = treeBuilds.get(store);
  if (recent !== undefined && Date.now() - recent.at < TREE_REUSE_MS) return recent.build;
  const build = buildProjectTreeSnapshot(store, treeOptions(context));
  treeBuilds.set(store, { at: Date.now(), build });
  // A failed build must not be served to the next request.
  build.catch(() => {
    if (treeBuilds.get(store)?.build === build) treeBuilds.delete(store);
  });
  return build;
}

/**
 * Sends the tree. When the full build (git scans) is not ready within a moment,
 * a folders-and-sessions snapshot goes first so the sidebar never waits on git;
 * the full one follows. `fresh` drops a reused build: after a change it would
 * show the tree from before it.
 */
async function sendTreeSnapshot(
  requestId: string,
  send: (message: ServerMessage) => void,
  store: ProjectStore,
  context: ProjectCommandContext,
  fresh = true,
): Promise<void> {
  if (context.tree === undefined) return;
  if (fresh) {
    treeBuilds.delete(store);
    forgetChangeCounts();
  }
  // Both builds read the agents: an iterator would be spent by the first.
  const shared: ProjectCommandContext = { ...context, ...(context.agents === undefined ? {} : { agents: [...context.agents] }) };
  const full = buildTree(store, shared);
  const early = await Promise.race([
    full,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), QUICK_TREE_WAIT_MS)),
  ]);
  if (early === null) {
    const quick = await buildProjectTreeSnapshot(store, { ...treeOptions(shared), sessionsOnly: true });
    send({ type: 'projectTreeSnapshot', requestId, nodes: quick.nodes, partial: true });
  }
  send({ type: 'projectTreeSnapshot', requestId, nodes: (await full).nodes });
}

interface ProjectNodeTarget {
  readonly projectId: string;
  readonly groupId?: string;
}

function targetForParent(state: ProjectState, parentId: string | undefined): ProjectNodeTarget {
  if (parentId === undefined) throw new LibraryUserError('Chọn Project hoặc nhóm đích.');
  const project = state.projects.find((candidate) => candidate.id === parentId);
  if (project !== undefined) return { projectId: project.id };
  for (const candidate of state.projects) {
    const group = findNode(candidate.children, parentId);
    if (group?.type === 'group') return { projectId: candidate.id, groupId: group.id };
  }
  throw new LibraryUserError('Không tìm thấy Project hoặc nhóm đích.');
}
function findNode(nodes: readonly ProjectNode[], nodeId: string): ProjectNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === 'group') {
      const found = findNode(node.children, nodeId);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function commandFor(type: string): ProjectCommandResultMessage['command'] {
  switch (type) {
    case 'projectNodeCreate': return 'create';
    case 'projectNodeUpdate': return 'update';
    case 'projectNodeDelete': return 'delete';
    case 'projectNodeMove': return 'move';
    case 'projectComment': return 'comment';
    case 'projectSettingsClear': return 'settingsClear';
    case 'projectSessionStop': return 'stop';
    case 'projectSessionWake': return 'wake';
    case 'projectImageSave': return 'imageSave';
    default: return 'settingsSet';
  }
}

function commandResult(
  requestId: string,
  command: ProjectCommandResultMessage['command'],
  ok: boolean,
  reason: string,
  nodeId?: string,
): ProjectCommandResultMessage {
  return {
    type: 'projectCommandResult', requestId, command, ok,
    ...(nodeId === undefined ? {} : { nodeId }), ...(reason === '' ? {} : { reason }),
  };
}

function safeReason(type: string): string {
  switch (type) {
    case 'projectNodeCreate': return 'Không thể tạo nút Project.';
    case 'projectNodeUpdate': return 'Không thể cập nhật nút Project.';
    case 'projectNodeDelete': return 'Không thể xóa nút Project.';
    case 'projectNodeMove': return 'Không thể di chuyển nút Project.';
    case 'projectComment': return 'Không thể gửi bình luận.';
    case 'projectSettingsSet':
    case 'projectSettingsClear': return 'Không thể cập nhật cài đặt Project.';
    case 'projectSessionStop': return 'Không thể tắt phiên.';
    case 'projectSessionWake': return 'Không mở lại được phiên.';
    case 'projectImageSave': return 'Không lưu được ảnh.';
    default: return 'Không thể thực hiện yêu cầu Project.';
  }
}

function mergePreviewFailure(
  msg: Record<string, unknown>,
  requestId: string,
  reason: string,
): ServerMessage {
  return {
    type: 'projectMergePreviewResult',
    requestId,
    repo: typeof msg.repo === 'string' ? msg.repo : '',
    branchA: typeof msg.branchA === 'string' ? msg.branchA : '',
    branchB: typeof msg.branchB === 'string' ? msg.branchB : '',
    clean: false,
    conflicts: [],
    reason,
  };
}

function branchCompareFailure(msg: Record<string, unknown>, requestId: string, reason: string): ServerMessage {
  const branchA = typeof msg.branchA === 'string' ? msg.branchA : '';
  const branchB = typeof msg.branchB === 'string' ? msg.branchB : '';
  const side = (branch: string) => ({
    branch, head: '', lastCommitAt: null, lastCommitSubject: null, dirtyFiles: [],
  });
  return {
    type: 'projectBranchCompare',
    requestId,
    repo: typeof msg.repo === 'string' ? msg.repo : '',
    branchA,
    branchB,
    a: side(branchA),
    b: side(branchB),
    mergeBase: null,
    onlyA: [],
    onlyB: [],
    commitsTruncated: false,
    files: [],
    mergeClean: false,
    conflicts: [],
    reason,
  };
}

function isDiffScope(value: unknown): value is 'uncommitted' | 'branch' | 'commit' | 'compare' {
  return value === 'uncommitted' || value === 'branch' || value === 'commit' || value === 'compare';
}
