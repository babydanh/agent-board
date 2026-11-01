/**
 * AgentContextMenu: the right-click menu on a piece of work, as one floating panel.
 *
 * It opens from the surface that was used, at the pointer or below the focused
 * row, and lists what that subject offers (agentMenu.ts decides the items). A
 * rename, a focus or a lifecycle control is sent here, and the menu stays open
 * until the server answers, so a refusal can be read. A destructive action asks
 * inline first. Escape steps back out of a rename or a confirm, then closes the
 * menu and returns focus to the element that opened it.
 */

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AgentInfo, CompanySessionSummary, HerdrAgent } from '../../../../core/src/company.js';
import type { HerdrSleepingSession, ProjectTreeNode, SquadRun, WorkItem, WorkItemAssignee } from '../../../../core/src/messages.js';
import { isBrowserRuntime } from '../../runtime.js';
import { serverToken } from '../../transport/serverToken.js';
import { workingFolder } from '../agentInfoView.js';
import {
  type AgentMenuAction,
  type AgentMenuItem,
  type AgentMenuRequest,
  type AgentMenuSubject,
  awakePaneOf,
  CLOUD_HANDOFF_PROMPT,
  type CopyWhat,
  HERDR_NAME_RULE,
  herdrMenuItems,
  herdrNameProblem,
  placeMenu,
  planningMenuItems,
  type Point,
  projectMenuItems,
  type ProjectNodeAction,
  projectNodeMenuItems,
  SESSION_NAME_MAX_LENGTH,
  type SessionControlAction,
  type SessionMenuFacts,
  sessionMenuItems,
  sessionNameProblem,
  sleepingMenuItems,
  squadRunMenuItems,
  taskCardMenuItems,
  workItemCardMenuItems,
  type WorkItemMenuAction,
  type WorkMenuFacts,
} from '../agentMenu.js';
import { pendingQuestionSessionIds, sleepingName } from '../agentSidebarView.js';
import { herdrAgentLabel, sessionLabelOf } from '../assigneeOptions.js';
import { copyText } from '../clipboard.js';
import { failureNotice } from '../commandResults.js';
import type { CompanyClient, CompanyCommandHandle } from '../companyClient.js';
import type { CompanyDrawerTab, CompanyViewState } from '../companyState.js';
import { HERDR_TONE_LABELS, type HerdrDrawerTab, herdrToneFor } from '../herdrView.js';
import { type ProjectStore, waitForProjectCreate } from '../projects/projectStore.js';
import { canMoveProjectNode } from '../projects/projectTreeView.js';
import { screenPlainText } from '../screenText.js';
import { DELETE_CONFIRM_DETAIL, REFUSED_NOTICE, sessionHoldsWork } from '../sessionActions.js';
import { deleteSessionsInOrder, removalNotice } from '../sessionRemoval.js';
import { findSquadRun, squadStatusLabel } from '../squadView.js';
import { sessionStatusLabel, taskStatusLabel } from '../statusLabels.js';
import { judgeChipFor, worktreeOffer } from '../workItemReviewView.js';
import { findWorkItem, statusWordVi } from '../workItemView.js';
import { CompanyButton } from './CompanyButton.js';
import { ConfirmAction } from './ConfirmAction.js';
import { FolderNameDialog } from './FolderNameDialog.js';
import { Icon } from './Icon.js';
import type { WorkDialogRequest } from './WorkDialogHost.js';

export interface AgentContextMenuProps {
  client: CompanyClient;
  state: CompanyViewState;
  request: AgentMenuRequest;
  onClose: () => void;
  onSessionTab: (sessionId: string, tab: CompanyDrawerTab) => void;
  onHerdrTab: (paneId: string, tab: HerdrDrawerTab) => void;
  onSelectTask: (taskId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenContract: (contractId: string) => void;
  onToggleMaximize: () => void;
  onToggleProject: (key: string) => void;
  onWorkDialog: (request: WorkDialogRequest) => void;
  onWorkItemAction: (
    ref: { id: string; workspacePath: string },
    action: WorkItemMenuAction,
  ) => void;
  onSelectSquad: (ref: { runId: string; workspacePath: string }) => void;
  onSquadRemoved: (ref: { runId: string; workspacePath: string }) => void;
  projectStore?: ProjectStore;
  onProjectNodeAction?: (node: ProjectTreeNode, action: ProjectNodeAction) => void;
}

/** The actions that ask first. Each names the item that opened the question. */
type ConfirmKind =
  | 'kill'
  | 'delete'
  | 'cancel-prompt'
  | 'clean'
  | 'squad-cancel'
  | 'squad-remove'
  | 'project-delete'
  | 'project-remove-folder'
  | 'project-stop'
  | 'close-herdr'
  | 'cloud-clean';

type MenuMode = 'menu' | 'rename' | 'folder-rename' | 'project-rename' | 'project-move' | 'project-create-group' | 'project-add-folder' | ConfirmKind;

interface Notice {
  text: string;
  failed: boolean;
}

interface ConfirmSpec {
  message: string;
  label: string;
  run: () => void;
}

/** What the menu reads from state for its subject. Each field is null or undefined when gone. */
interface MenuFacts {
  session: CompanySessionSummary | undefined;
  sessionFacts: SessionMenuFacts | null;
  agent: HerdrAgent | undefined;
  sleeping: HerdrSleepingSession | undefined;
  task: { code: string; title: string; status: string } | undefined;
  workItem: WorkItem | undefined;
  squadRun: SquadRun | undefined;
  prompt: { preview: string } | undefined;
  folder: string | null;
  taskContractId: string | null;
  work: WorkMenuFacts;
}

const ITEM_SELECTOR = 'button[role="menuitem"]:not([aria-disabled="true"])';
const NOT_SENT_NOTICE = 'Không gửi được.';
const COPY_FAILED_NOTICE = 'Không sao chép được vào bộ nhớ tạm.';
const GONE_TEXT = 'Mục này không còn trên bảng.';

/**
 * A browser tab without the server token is read-only: the server refuses its company commands,
 * so no item here may send one. This is the rule PreviewPrompt applies to its input.
 */
const CONNECTION_PRIVILEGED = !isBrowserRuntime || serverToken !== null;

/** The session a menu acts on: a session row's own, or the one a task or planning card names. */
function actingSessionId(subject: AgentMenuSubject): string | null {
  switch (subject.kind) {
    case 'session':
    case 'task':
    case 'planning':
      return subject.sessionId;
    case 'workItem':
    case 'herdr':
    case 'sleeping':
    case 'squad':
    case 'project':
    case 'projectNode':
      return null;
  }
}

/** The folder a herdr pane works in: herdr's own cwd first, else the one its info reports. */
function herdrFolder(cwd: string | undefined, info: AgentInfo | undefined): string | null {
  return cwd || (info === undefined ? null : workingFolder(info)) || null;
}

/**
 * The agent a work action names, with the label its dialog shows: a herdr pane, or the omp
 * session a session row or task card acts on. Null for any other subject.
 */
function workAgentOf(
  subject: AgentMenuSubject,
  agent: HerdrAgent | undefined,
  session: CompanySessionSummary | undefined,
): { assignee: WorkItemAssignee; label: string } | null {
  switch (subject.kind) {
    case 'herdr':
      if (agent === undefined) return null;
      return { assignee: { kind: 'herdr', paneId: agent.paneId }, label: herdrAgentLabel(agent) };
    case 'session':
    case 'task':
      if (session === undefined) return null;
      return { assignee: { kind: 'session', sessionId: session.id }, label: sessionLabelOf(session) };
    case 'workItem':
    case 'planning':
    case 'sleeping':
    case 'squad':
    case 'project':
    case 'projectNode':
      return null;
  }
}

/** The items for the subject; null when what it names is gone from the board. */
function itemsFor(subject: AgentMenuSubject, facts: MenuFacts): AgentMenuItem[] | null {
  switch (subject.kind) {
    case 'session':
      return facts.sessionFacts === null
        ? null
        : sessionMenuItems(facts.sessionFacts, subject.drawer);
    case 'task':
      if (facts.task === undefined) return null;
      return taskCardMenuItems(
        { code: facts.task.code, contractId: facts.taskContractId },
        facts.sessionFacts,
        subject.drawer,
      );
    case 'workItem': {
      const workItem = facts.workItem;
      if (workItem === undefined) return null;
      return workItemCardMenuItems({
        id: workItem.id,
        sequence: workItem.sequence,
        text: workItem.text,
        status: workItem.status,
        privileged: CONNECTION_PRIVILEGED,
        canJudge: judgeChipFor(workItem)?.rejudge === true,
        canCleanWorktree: worktreeOffer(workItem) === 'clean',
        canAskLeader: workItem.status === 'review' && workItem.squadRunId === undefined,
      });
    }
    case 'squad': {
      const run = facts.squadRun;
      if (run === undefined) return null;
      return squadRunMenuItems({
        runId: run.id,
        request: run.request,
        status: run.status,
        hasProposal: run.proposal !== undefined,
        privileged: CONNECTION_PRIVILEGED,
      });
    }
    case 'planning':
      return facts.prompt === undefined ? null : planningMenuItems(facts.session !== undefined);
    case 'herdr':
      if (facts.agent === undefined) return null;
      return herdrMenuItems(facts.folder, subject.drawer, facts.work, facts.agent.kind === 'omp');
    case 'sleeping':
      return facts.sleeping === undefined ? null : sleepingMenuItems(subject.drawer);
    case 'project':
      return projectMenuItems(subject.project);
    case 'projectNode':
      return projectNodeMenuItems(subject.node, subject.menu);
  }
}

/** The two lines the menu's header prints about what it is open on. */
function headerLines(
  subject: AgentMenuSubject,
  facts: MenuFacts,
): { title: string; subtitle: string } {
  switch (subject.kind) {
    case 'session':
      if (facts.session === undefined) return { title: 'Phiên không còn', subtitle: '' };
      return {
        title: `${facts.session.code} · ${facts.session.name}`,
        subtitle: sessionStatusLabel(facts.session.status),
      };
    case 'task':
      if (facts.task === undefined) return { title: 'Việc không còn trên bảng', subtitle: '' };
      return {
        title: `${facts.task.code} · ${facts.task.title}`,
        subtitle: taskStatusLabel(facts.task.status),
      };
    case 'workItem':
      if (facts.workItem === undefined)
        return { title: 'Việc không còn trên bảng', subtitle: '' };
      return {
        title: `#${facts.workItem.sequence} · ${facts.workItem.text}`,
        subtitle: statusWordVi(facts.workItem.status),
      };
    case 'squad':
      if (facts.squadRun === undefined) return { title: 'Lượt Đội không còn', subtitle: '' };
      return {
        title: `Đội · ${facts.squadRun.id}`,
        subtitle: squadStatusLabel(facts.squadRun.status),
      };
    case 'planning':
      return { title: 'Prompt đang lập kế hoạch', subtitle: facts.prompt?.preview ?? '' };
    case 'herdr':
      if (facts.agent === undefined)
        return { title: 'Agent herdr', subtitle: 'Không còn trong herdr' };
      return {
        title: `${facts.agent.kind} · ${facts.agent.paneId}`,
        subtitle: HERDR_TONE_LABELS[herdrToneFor(facts.agent.status)],
      };
    case 'sleeping':
      if (facts.sleeping === undefined) return { title: 'Phiên ngủ đông không còn', subtitle: '' };
      return { title: sleepingName(facts.sleeping), subtitle: 'Ngủ đông' };
    case 'project':
      return { title: subject.project.name, subtitle: subject.project.path ?? '' };
    case 'projectNode':
      return {
        title: subject.node.name,
        subtitle: subject.node.kind === 'session'
          ? [subject.node.agentKind, subject.node.state].filter(Boolean).join(' · ')
          : subject.node.path ?? subject.node.branch ?? '',
      };
  }
}

/** The next item to focus for a navigation key, or null when the key moves nothing. */
function nextItemIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

function enabledItems(menu: HTMLElement | null): HTMLElement[] {
  return menu === null ? [] : Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

export function AgentContextMenu({
  client,
  state,
  request,
  onClose,
  onSessionTab,
  onHerdrTab,
  onSelectTask,
  onSelectSession,
  onOpenContract,
  onToggleMaximize,
  onToggleProject,
  onWorkDialog,
  onWorkItemAction,
  onSelectSquad,
  onSquadRemoved,
  projectStore,
  onProjectNodeAction,
}: AgentContextMenuProps) {
  const { subject, anchor, returnFocus } = request;
  const sessionId = actingSessionId(subject);
  const paneId = subject.kind === 'herdr' || subject.kind === 'sleeping' ? subject.paneId : null;
  const isHerdr = subject.kind === 'herdr';
  const session = sessionId === null ? undefined : state.sessions[sessionId];
  const sessionInfo = sessionId === null ? undefined : state.sessionInfos[sessionId];
  const agent =
    paneId === null ? undefined : state.herdr.agents.find((entry) => entry.paneId === paneId);
  const paneInfo = paneId === null ? undefined : state.herdr.infos[paneId];
  const sleeping =
    subject.kind === 'sleeping'
      ? state.herdr.sleeping.find((entry) => entry.paneId === subject.paneId)
      : undefined;
  const task = subject.kind === 'task' ? state.tasks[subject.taskId] : undefined;
  const workItem =
    subject.kind === 'workItem'
      ? findWorkItem(state, { id: subject.id, workspacePath: subject.workspacePath })
      : undefined;
  const squadRun =
    subject.kind === 'squad'
      ? findSquadRun(state, { runId: subject.runId, workspacePath: subject.workspacePath })
      : undefined;
  const prompt =
    subject.kind === 'planning'
      ? state.prompts.find((entry) => entry.id === subject.promptId)
      : undefined;
  const folder = isHerdr
    ? herdrFolder(agent?.cwd, paneInfo)
    : sessionInfo === undefined
      ? null
      : workingFolder(sessionInfo);
  const holdsWork =
    session !== undefined &&
    sessionHoldsWork(session, pendingQuestionSessionIds(state).has(session.id));
  // The folder this agent's work is queued in: the one the server tags its folder with.
  const taggedFolder = isHerdr
    ? agent?.workspacePath
    : session === undefined
      ? undefined
      : state.folderOf[session.id];
  const work: WorkMenuFacts = { folder: taggedFolder || null, privileged: CONNECTION_PRIVILEGED };
  const workAgent = workAgentOf(subject, agent, session);
  const facts: MenuFacts = {
    session,
    sessionFacts:
      session === undefined ? null : { status: session.status, cwd: folder, holdsWork, work },
    agent,
    sleeping,
    task,
    prompt,
    workItem,
    squadRun,
    folder,
    taskContractId:
      task !== undefined && task.contractId in state.contracts ? task.contractId : null,
    work,
  };
  const items = itemsFor(subject, facts);
  const header = headerLines(subject, facts);
  const cleanIds = subject.kind === 'project' ? subject.project.cleanable : [];

  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<Point>(anchor);
  const [mode, setMode] = useState<MenuMode>('menu');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Set before the first cloud handoff is sent: each one opens a GitHub Issue, so this menu sends at most one.
  const handoffSent = useRef(false);
  function sendHandoff(pane: string | null): void {
    if (pane === null || handoffSent.current) return;
    handoffSent.current = true;
    track(client.herdrPrompt(pane, CLOUD_HANDOFF_PROMPT));
  }
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [projectPathDraft, setProjectPathDraft] = useState('');
  // Recent board folders not yet in any Project: one click instead of typing a path.
  const folderSuggestions = (state.workspaces ?? []).filter((entry) => {
    if (entry.missing === true) return false;
    const key = entry.path.replaceAll('\\', '/').toLowerCase();
    return !(projectStore?.getSnapshot().nodes ?? []).some(
      (node) => node.kind === 'folder' && node.path?.replaceAll('\\', '/').toLowerCase() === key,
    );
  }).slice(0, 6);
  const [pendingSquadRemoval, setPendingSquadRemoval] = useState<{
    runId: string;
    workspacePath: string;
  } | null>(null);

  const sessionKnown = session !== undefined;
  const paneKnown = agent !== undefined;

  // The menu asks for the agent's info on open, so the folder copy and the info
  // tab are ready. A request is read-only; it is not repeated on every update.
  useEffect(() => {
    if (sessionId !== null && sessionKnown) client.requestSessionInfo(sessionId);
  }, [client, sessionId, sessionKnown]);

  useEffect(() => {
    if (paneId !== null && paneKnown) client.requestHerdrInfo(paneId);
  }, [client, paneId, paneKnown]);

  // Focus the first enabled item, or the rename box when renaming.
  useEffect(() => {
    if (mode === 'rename') {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    const first = enabledItems(menuRef.current).at(0);
    (first ?? menuRef.current)?.focus({ preventScroll: true });
  }, [mode]);

  // Clamp the menu to the viewport once its size is known, before it is painted.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const rect = menu.getBoundingClientRect();
    setPosition(
      placeMenu(
        anchor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, mode, notice]);

  // Escape, a pointer press outside, scrolling anywhere else, or a resize closes the menu.
  useEffect(() => {
    // The folder-name dialog takes the keys and the pointer; the menu stays out of its way.
    if (mode === 'folder-rename') return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (mode !== 'menu') {
        setMode('menu');
        return;
      }
      returnFocus?.focus({ preventScroll: true });
      onClose();
    }
    function onPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    }
    function onScroll(event: Event): void {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [mode, onClose, returnFocus]);

  // A rename, a focus or a control is in flight: the menu closes on success and
  // shows the server's reason on a refusal, read from the command result.
  useEffect(() => {
    if (pending === null) return;
    const outcome = state.commandResults[pending];
    if (outcome === undefined) return;
    if (outcome.ok) {
      if (pendingSquadRemoval !== null) onSquadRemoved(pendingSquadRemoval);
      onClose();
      return;
    }
    setPending(null);
    setPendingSquadRemoval(null);
    setNotice({ text: outcome.message ?? outcome.errorCode ?? REFUSED_NOTICE, failed: true });
  }, [pending, state.commandResults, onClose, onSquadRemoved, pendingSquadRemoval]);

  function track(handle: CompanyCommandHandle): void {
    const failure = failureNotice(handle, NOT_SENT_NOTICE);
    if (failure !== null) {
      setNotice({ text: failure, failed: true });
      return;
    }
    setNotice(null);
    setPending(handle.requestId);
  }

  function control(action: SessionControlAction): void {
    if (sessionId === null) return;
    track(client.controlSession(sessionId, action));
  }

  // Closing the rename dialog closes the menu it came from, and returns focus to the item's opener.
  function closeFolderRename(): void {
    returnFocus?.focus({ preventScroll: true });
    onClose();
  }

  function copyValue(what: CopyWhat): string | null {
    switch (what) {
      case 'cwd':
        return folder;
      case 'sessionCode':
        return session?.code ?? null;
      case 'paneId':
        return paneId;
      case 'taskCode':
        return task?.code ?? null;
      case 'workItemCode':
        return workItem === undefined ? null : `#${workItem.sequence}`;
      case 'workItemText':
        return workItem?.text ?? null;
      case 'squadRunCode':
        return squadRun?.id ?? null;
      case 'squadRequest':
        return squadRun?.request ?? null;
      case 'path':
        return subject.kind === 'project' ? subject.project.path : null;
      case 'screen': {
        const screen = paneId === null ? undefined : state.herdr.screens[paneId];
        return screen === undefined ? null : screenPlainText(screen.text);
      }
    }
  }

  async function copy(what: CopyWhat): Promise<void> {
    const text = copyValue(what);
    if (text === null) return;
    const copied = await copyText(text);
    setNotice(
      copied
        ? {
            text: what === 'screen' ? 'Đã sao chép màn hình.' : `Đã sao chép: ${text}`,
            failed: false,
          }
        : { text: COPY_FAILED_NOTICE, failed: true },
    );
  }

  async function runClean(ids: readonly string[]): Promise<void> {
    setBusy(true);
    const report = await deleteSessionsInOrder(client, ids);
    setBusy(false);
    setMode('menu');
    setNotice({ text: removalNotice(report), failed: report.refused > 0 });
  }

  function nodeAncestor(node: ProjectTreeNode, kind: 'project' | 'group'): string | undefined {
    if (node.kind === kind) return node.id;
    const allNodes = projectStore?.getSnapshot().nodes ?? [];
    let parentId = node.parentId;
    while (parentId !== undefined) {
      const parent = allNodes.find((entry) => entry.id === parentId);
      if (parent === undefined) return undefined;
      if (parent.kind === kind) return parent.id;
      parentId = parent.parentId;
    }
    return undefined;
  }

  function executeProjectNodeAction(action: ProjectNodeAction): void {
    if (subject.kind !== 'projectNode') return;
    const node = subject.node;
    if (action === 'copyPath' || action === 'copyBranch' || action === 'copySessionId') {
      const text = action === 'copyPath' ? node.path : action === 'copyBranch' ? node.branch : node.sessionId;
      if (text !== undefined) void copyText(text).then((copied) => setNotice({
        text: copied ? `Đã sao chép: ${text}` : COPY_FAILED_NOTICE,
        failed: !copied,
      }));
      return;
    }
    if (action === 'rename') {
      setDraft(node.name);
      setMode('project-rename');
      return;
    }
    if (action === 'delete') {
      setMode('project-delete');
      return;
    }
    if (action === 'cloudHandoff') {
      sendHandoff(awakePaneOf(node));
      return;
    }
    if (action === 'stop') {
      setMode('project-stop');
      return;
    }
    if (action === 'closeHerdr') {
      setMode('close-herdr');
      return;
    }
    if (action === 'cloudClean') {
      setMode('cloud-clean');
      return;
    }
    if (action === 'removeFolder') {
      setMode('project-remove-folder');
      return;
    }
    if (action === 'moveTo') {
      setMode('project-move');
      return;
    }
    if (action === 'createGroup') {
      setDraft('');
      setMode('project-create-group');
      return;
    }
    if (action === 'addFolder') {
      setDraft('');
      setProjectPathDraft('');
      setMode('project-add-folder');
      return;
    }
    onProjectNodeAction?.(node, action);
    onClose();
  }

  function submitProjectRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (subject.kind !== 'projectNode' || draft.trim() === '') return;
    const node = subject.node;
    const name = draft.trim();
    if (node.kind === 'session') {
      if (projectRenameProblem !== null) return;
      if (node.boardSessionId !== undefined) track(client.renameSession(node.boardSessionId, name));
      else {
        const pane = awakePaneOf(node);
        if (pane !== null) track(client.herdrRename(pane, name));
      }
      return;
    }
    projectStore?.updateNode({ nodeId: node.id, name });
    onClose();
  }

  function moveProjectNode(targetId: string): void {
    if (subject.kind !== 'projectNode' || projectStore === undefined) return;
    const node = subject.node;
    const allNodes = projectStore.getSnapshot().nodes;
    const target = allNodes.find((entry) => entry.id === targetId);
    if (target === undefined || !canMoveProjectNode(allNodes, node.id, target.id)) return;
    projectStore.moveNode({ nodeId: node.id, parentId: target.id });
    onClose();
  }

  function confirmSpec(kind: ConfirmKind): ConfirmSpec {
    switch (kind) {
      case 'kill':
        return {
          message: `Tắt phiên ${session?.code ?? ''}? Phiên đang chạy sẽ bị dừng ngay.`,
          label: 'Tắt phiên',
          run: () => control('kill'),
        };
      case 'delete':
        return {
          message: `Xoá phiên ${session?.code ?? ''}? ${DELETE_CONFIRM_DETAIL}`,
          label: 'Xoá phiên',
          run: () => control('delete'),
        };
      case 'cancel-prompt':
        return {
          message: 'Huỷ prompt này? Prompt chưa thành Contract sẽ bị bỏ.',
          label: 'Huỷ prompt',
          run: () => {
            if (subject.kind === 'planning') track(client.cancelPrompt(subject.promptId));
          },
        };
      case 'clean':
        return {
          message: `Xoá ${cleanIds.length} phiên lỗi của ${header.title}? ${DELETE_CONFIRM_DETAIL}`,
          label: 'Xoá các phiên',
          run: () => void runClean(cleanIds),
        };
      case 'squad-cancel':
        return {
          message: 'Huỷ lượt Đội này? Các việc đã tạo từ đề xuất được duyệt vẫn tiếp tục.',
          label: 'Huỷ lượt',
          run: () => {
            if (subject.kind === 'squad' && squadRun !== undefined) {
              track(client.cancelSquad(subject.workspacePath, squadRun.id));
            }
          },
        };
      case 'squad-remove':
        return {
          message: 'Xoá lượt Đội khỏi bảng? Các việc đã tạo vẫn được giữ.',
          label: 'Xoá khỏi bảng',
          run: () => {
            if (subject.kind !== 'squad' || squadRun === undefined) return;
            const ref = { runId: squadRun.id, workspacePath: subject.workspacePath };
            const handle = client.removeSquad(subject.workspacePath, squadRun.id);
            if (handle.ok) setPendingSquadRemoval(ref);
            track(handle);
          },
        };
      case 'project-delete':
        return {
          message: subject.kind === 'projectNode' && subject.node.kind === 'group'
            ? `Xoá nhóm ${subject.node.name}? Các mục con sẽ chuyển lên cấp trên.`
            : `Xoá ${subject.kind === 'projectNode' ? subject.node.name : 'project'} khỏi danh sách? Tệp trên đĩa vẫn được giữ.`,
          label: 'Xoá khỏi danh sách',
          run: () => {
            if (subject.kind === 'projectNode') projectStore?.deleteNode(subject.node.id);
            onClose();
          },
        };
      case 'project-remove-folder':
        return {
          message: `Bỏ thư mục ${subject.kind === 'projectNode' ? subject.node.name : ''} khỏi project? Tệp trên đĩa vẫn được giữ.`,
          label: 'Bỏ khỏi project',
          run: () => {
            if (subject.kind === 'projectNode') projectStore?.deleteNode(subject.node.id);
            onClose();
          },
        };
      case 'project-stop':
        return {
          message: `Tắt phiên ${subject.kind === 'projectNode' ? subject.node.name : ''}? Tiến trình agent và các lệnh nó đang chạy dừng ngay; việc chưa lưu của phiên sẽ mất.`,
          label: 'Tắt phiên',
          run: () => {
            if (subject.kind === 'projectNode' && subject.node.sessionId !== undefined) {
              projectStore?.stopSession(subject.node.sessionId);
            }
            onClose();
          },
        };
      case 'cloud-clean':
        return {
          message: `Xoá phiên cloud ${subject.kind === 'projectNode' ? subject.node.name : ''}? Máy cloud tắt agent, gỡ worktree và nhánh cục bộ của phiên. Commit chưa push được đẩy lên nhánh cloud/… trên GitHub trước khi xoá nên không mất; máy từ chối nếu còn file chưa commit.`,
          label: 'Xoá phiên cloud',
          run: () => {
            if (subject.kind === 'projectNode') onProjectNodeAction?.(subject.node, 'cloudClean');
            onClose();
          },
        };
      case 'close-herdr': {
        const sleepingPane = subject.kind === 'sleeping' ||
          (subject.kind === 'projectNode' && subject.node.state === 'sleeping');
        const message = sleepingPane
          ? 'Xoá phiên này? Pane herdr sẽ bị đóng. Lịch sử omp vẫn còn trong file phiên.'
          : 'Xoá phiên này? Pane herdr sẽ bị đóng; phiên đang chạy sẽ dừng. Lịch sử omp vẫn còn trong file phiên.';
        return {
          message,
          label: 'Xoá phiên',
          run: () => {
            if (subject.kind === 'projectNode') onProjectNodeAction?.(subject.node, 'closeHerdr');
            else if (paneId !== null) track(client.herdrClose(paneId));
            onClose();
          },
        };
      }
    }
  }

  function runItem(entry: AgentMenuItem): void {
    if (entry.disabled) return;
    const action: AgentMenuAction = entry.action;
    switch (action.kind) {
      case 'sessionTab':
        if (sessionId !== null) onSessionTab(sessionId, action.tab);
        onClose();
        return;
      case 'herdrTab':
        if (paneId !== null) onHerdrTab(paneId, action.tab);
        onClose();
        return;
      case 'rename':
        setDraft((isHerdr ? agent?.name : session?.name) ?? '');
        setNotice(null);
        setMode('rename');
        return;
      case 'copy':
        void copy(action.what);
        return;
      case 'control':
        if (action.action === 'kill' || action.action === 'delete') {
          setNotice(null);
          setMode(action.action);
          return;
        }
        control(action.action);
        return;
      case 'focus':
        if (paneId !== null) track(client.herdrFocus(paneId));
        return;
      case 'readScreen':
        if (paneId !== null) track(client.herdrRead(paneId));
        return;
      case 'maximize':
        onToggleMaximize();
        onClose();
        return;
      case 'openTask':
        if (subject.kind === 'task') onSelectTask(subject.taskId);
        onClose();
        return;
      case 'openContract':
        onOpenContract(action.contractId);
        onClose();
        return;
      case 'openSession':
        if (subject.kind === 'planning' && subject.sessionId !== null) {
          onSelectSession(subject.sessionId);
        }
        onClose();
        return;
      case 'cancelPrompt':
        setNotice(null);
        setMode('cancel-prompt');
        return;
      case 'toggleProject':
        if (subject.kind === 'project') onToggleProject(subject.project.key);
        onClose();
        return;
      case 'renameFolder':
        setNotice(null);
        setMode('folder-rename');
        return;
      case 'openBoardFolder':
        if (subject.kind === 'project' && subject.project.switchTo !== null) {
          track(client.openWorkspace(subject.project.switchTo));
        }
        return;
      case 'cleanErrored':
        setNotice(null);
        setMode('clean');
        return;
      case 'wake':
        if (paneId !== null) track(client.herdrWake(paneId));
        return;
      case 'closeHerdr':
        setNotice(null);
        setMode('close-herdr');
        return;
      case 'cloudHandoff':
        sendHandoff(paneId);
        return;
      case 'assignWork':
        if (workAgent !== null && work.folder !== null) {
          onWorkDialog({
            kind: 'assign',
            workspacePath: work.folder,
            assignee: workAgent.assignee,
            label: workAgent.label,
          });
        }
        onClose();
        return;
      case 'describeRole':
        if (workAgent !== null && work.folder !== null) {
          onWorkDialog({
            kind: 'role',
            workspacePath: work.folder,
            agent: workAgent.assignee,
            label: workAgent.label,
          });
        }
        onClose();
        return;
      case 'workItemAction':
        if (subject.kind === 'workItem') {
          onWorkItemAction(
            { id: subject.id, workspacePath: subject.workspacePath },
            action.action,
          );
        }
        onClose();
        return;
      case 'squadAction':
        if (subject.kind !== 'squad' || squadRun === undefined) return;
        if (action.action === 'open' || action.action === 'approve') {
          onSelectSquad({ runId: squadRun.id, workspacePath: subject.workspacePath });
          onClose();
          return;
        }
        if (action.action === 'dismiss') {
          if (squadRun.proposal !== undefined) {
            track(
              client.dismissSquad(
                subject.workspacePath,
                squadRun.id,
                squadRun.proposal.id,
              ),
            );
          }
          return;
        }
        if (action.action === 'retry') {
          track(client.retrySquad(subject.workspacePath, squadRun.id));
          return;
        }
        setNotice(null);
        setMode(action.action === 'cancel' ? 'squad-cancel' : 'squad-remove');
        return;
      case 'projectNodeAction':
        executeProjectNodeAction(action.action);
        return;
    }
  }

  const problem = isHerdr ? herdrNameProblem(draft) : sessionNameProblem(draft);
  const showProblem = draft.trim() !== '' && problem !== null;
  const ruleHint = isHerdr ? HERDR_NAME_RULE : `Tối đa ${SESSION_NAME_MAX_LENGTH} ký tự.`;

  // Renaming a project-tree session row: a board session takes a free name, a bare herdr pane the a-z rule.
  const sessionRowNode = subject.kind === 'projectNode' && subject.node.kind === 'session' ? subject.node : null;
  const sessionRowIsBoard = sessionRowNode?.boardSessionId !== undefined;
  const projectRenameProblem =
    sessionRowNode === null ? null : sessionRowIsBoard ? sessionNameProblem(draft) : herdrNameProblem(draft);
  const showProjectRenameProblem = draft.trim() !== '' && projectRenameProblem !== null;

  function submitRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (problem !== null) return;
    const name = draft.trim();
    if (isHerdr) {
      if (paneId !== null) track(client.herdrRename(paneId, name));
      return;
    }
    if (sessionId !== null) track(client.renameSession(sessionId, name));
  }

  /**
   * "Duyệt…": the board opens Windows' dialog and adds the folder chosen to this Project. The menu
   * closes now: it closes on any scroll or click, and the dialog may stay open for a while.
   */
  function browseIntoProject(): void {
    if (subject.kind !== 'projectNode') return;
    onProjectNodeAction?.(subject.node, 'addFolderBrowse');
    onClose();
  }

  async function submitProjectNodeCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (subject.kind !== 'projectNode' || projectStore === undefined) return;
    const node = subject.node;
    const projectId = nodeAncestor(node, 'project');
    if (projectId === undefined) return;
    const parentId = node.kind === 'group' ? node.id : projectId;
    if (mode === 'project-create-group' && draft.trim() !== '') {
      projectStore.createNode({ kind: 'group', parentId, name: draft.trim() });
      onClose();
      return;
    }
    const folderPath = projectPathDraft.trim();
    if (mode !== 'project-add-folder' || folderPath === '') return;
    const name = draft.trim() || folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || folderPath;
    setNotice(null);
    const outcome = await waitForProjectCreate(projectStore, projectStore.createNode({ kind: 'folder', parentId, name, path: folderPath }));
    // A refused folder keeps the form open with the reason, so the path can be fixed.
    if ('refusal' in outcome) {
      setNotice({ text: `Không thêm được thư mục: ${outcome.refusal}`, failed: true });
      return;
    }
    onClose();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (mode !== 'menu') return;
    if (event.key === 'Tab') {
      onClose();
      return;
    }
    const menuItems = enabledItems(menuRef.current);
    const current = menuItems.indexOf(document.activeElement as HTMLElement);
    const next = nextItemIndex(event.key, current, menuItems.length);
    if (next === null) return;
    event.preventDefault();
    menuItems.at(next)?.focus({ preventScroll: true });
  }

  // The folder-name dialog replaces the menu while it is open; the menu stays mounted under it.
  const renamingFolder =
    mode === 'folder-rename' && subject.kind === 'project' ? subject.project.path : null;
  if (renamingFolder !== null) {
    return (
      <FolderNameDialog
        client={client}
        path={renamingFolder}
        currentName={state.workspaces?.find((entry) => entry.path === renamingFolder)?.name ?? null}
        onClose={closeFolderRename}
      />
    );
  }
  const confirm =
    mode === 'menu' || mode === 'rename' || mode === 'folder-rename' || mode === 'project-rename' || mode === 'project-move' || mode === 'project-create-group' || mode === 'project-add-folder'
      ? null
      : confirmSpec(mode);

  return (
    <div
      ref={menuRef}
      data-testid="agent-menu"
      tabIndex={-1}
      onKeyDown={onMenuKeyDown}
      className="fixed z-50 min-w-[220px] max-w-[min(280px,calc(100vw-16px))] rounded-(--company-radius-md) border border-hairline bg-raised py-1 text-xs text-text"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 pt-1.5 pb-2">
        <p className="truncate font-semibold text-text">{header.title}</p>
        {header.subtitle !== '' && (
          <p className="truncate text-2xs text-text-muted">{header.subtitle}</p>
        )}
      </div>

      {items === null ? (
        <p className="px-3 py-2 text-text-muted">{GONE_TEXT}</p>
      ) : mode === 'menu' ? (
        <div role="menu" aria-label="Thao tác" className="flex flex-col py-0.5">
          {items.map((entry) => (
            <MenuItemButton key={entry.id} item={entry} onRun={runItem} />
          ))}
        </div>
      ) : mode === 'project-create-group' ? (
        <form onSubmit={(event) => void submitProjectNodeCreate(event)} className="flex flex-col gap-2 px-3 py-2">
          <label className="flex flex-col gap-1 text-text-muted">
            Tên nhóm
            <input ref={inputRef} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text" />
          </label>
          <div className="flex gap-1">
            <CompanyButton type="submit" size="sm" disabled={draft.trim() === '' || projectStore === undefined}>Tạo nhóm</CompanyButton>
            <CompanyButton size="sm" onClick={() => setMode('menu')}>Quay lại</CompanyButton>
          </div>
        </form>
      ) : mode === 'project-add-folder' ? (
        <form onSubmit={(event) => void submitProjectNodeCreate(event)} className="flex flex-col gap-2 px-3 py-2">
          {folderSuggestions.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-text-muted">Thư mục gần đây</p>
              {folderSuggestions.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  title={entry.path}
                  onClick={() => setProjectPathDraft(entry.path)}
                  className={`truncate rounded-(--company-radius-sm) px-2 py-1 text-left hover:bg-hover ${projectPathDraft === entry.path ? 'bg-selected text-text' : 'text-text-secondary'}`}
                >
                  {entry.name ?? entry.path}
                </button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1 text-text-muted">
            Đường dẫn thư mục
            <span className="flex gap-1">
              <input ref={inputRef} autoFocus value={projectPathDraft} placeholder="D:\du-an\thu-muc" onChange={(event) => setProjectPathDraft(event.target.value)} className="min-w-0 flex-1 rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text" />
              <CompanyButton size="sm" onClick={browseIntoProject}>Duyệt…</CompanyButton>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-text-muted">
            Tên hiển thị (tuỳ chọn)
            <input value={draft} onChange={(event) => setDraft(event.target.value)} className="rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text" />
          </label>
          <div className="flex gap-1">
            <CompanyButton type="submit" size="sm" disabled={projectPathDraft.trim() === '' || projectStore === undefined}>Thêm thư mục</CompanyButton>
            <CompanyButton size="sm" onClick={() => setMode('menu')}>Quay lại</CompanyButton>
          </div>
        </form>
      ) : mode === 'project-rename' ? (
        <form onSubmit={submitProjectRename} className="flex flex-col gap-2 px-3 py-2">
          <label className="flex flex-col gap-1 text-text-muted">
            Tên hiển thị
            <input ref={inputRef} autoFocus aria-invalid={showProjectRenameProblem} value={draft} onChange={(event) => setDraft(event.target.value)} className="rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text" />
          </label>
          {sessionRowNode !== null && (
            <p className={showProjectRenameProblem ? 'text-danger' : 'text-2xs text-text-muted'}>
              {showProjectRenameProblem ? projectRenameProblem : sessionRowIsBoard ? `Tối đa ${SESSION_NAME_MAX_LENGTH} ký tự.` : HERDR_NAME_RULE}
            </p>
          )}
          <div className="flex gap-1">
            <CompanyButton type="submit" size="sm" disabled={draft.trim() === '' || projectRenameProblem !== null || pending !== null}>Lưu</CompanyButton>
            <CompanyButton size="sm" onClick={() => setMode('menu')}>Quay lại</CompanyButton>
          </div>
        </form>
      ) : mode === 'project-move' ? (
        <div className="flex flex-col gap-2 px-3 py-2">
          <p className="text-text-muted">Chuyển tới project hoặc nhóm</p>
          {(projectStore?.getSnapshot().nodes ?? [])
            .filter((node) => (node.kind === 'project' || node.kind === 'group') && subject.kind === 'projectNode' && canMoveProjectNode(projectStore?.getSnapshot().nodes ?? [], subject.node.id, node.id))
            .map((node) => <CompanyButton key={node.id} size="sm" onClick={() => moveProjectNode(node.id)}>{node.name}</CompanyButton>)}
          <CompanyButton size="sm" onClick={() => setMode('menu')}>Quay lại</CompanyButton>
        </div>
      ) : mode === 'rename' ? (
        <form onSubmit={submitRename} className="flex flex-col gap-2 px-3 py-2">
          <label className="flex flex-col gap-1 text-text-muted">
            Tên mới
            <input
              ref={inputRef}
              aria-describedby="agent-rename-hint"
              aria-invalid={showProblem}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMode('menu');
              }}
              className="rounded-(--company-radius-sm) bg-well px-2 py-1 text-xs text-text"
            />
          </label>
          <p id="agent-rename-hint" className="text-2xs text-text-muted">
            {ruleHint}
          </p>
          {showProblem && (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          )}
          <div className="flex gap-1">
            <CompanyButton type="submit" size="sm" disabled={problem !== null || pending !== null}>
              Lưu
            </CompanyButton>
            <CompanyButton size="sm" onClick={() => setMode('menu')}>
              Quay lại
            </CompanyButton>
          </div>
        </form>
      ) : confirm === null ? null : (
        <div className="px-3 py-2">
          <ConfirmAction
            message={confirm.message}
            confirmLabel={confirm.label}
            danger
            disabled={pending !== null || busy}
            onConfirm={confirm.run}
            onCancel={() => setMode('menu')}
          />
        </div>
      )}

      {notice !== null && (
        <p
          role="status"
          className={`mt-1 px-3 py-1.5 ${notice.failed ? 'text-danger' : 'text-text-muted'}`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}

function MenuItemButton({
  item,
  onRun,
}: {
  item: AgentMenuItem;
  onRun: (item: AgentMenuItem) => void;
}) {
  const tone = item.disabled
    ? 'cursor-default text-text-muted'
    : item.danger
      ? 'text-danger hover:bg-hover focus-visible:bg-hover'
      : 'text-text hover:bg-hover focus-visible:bg-hover';
  return (
    <>
      {item.startsGroup && <div role="separator" className="my-1" />}
      <button
        type="button"
        role="menuitem"
        aria-disabled={item.disabled}
        title={item.title ?? undefined}
        onClick={() => onRun(item)}
        className={`touch-target flex h-7 w-full items-center justify-between gap-3 px-3 text-left outline-none ${tone}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            name={item.icon}
            className={`size-3.5 shrink-0 ${item.danger ? '' : 'text-text-muted'}`}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {item.hint !== null && (
          <span className="shrink-0 text-2xs text-text-muted">{item.hint}</span>
        )}
      </button>
    </>
  );
}
