import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';

import { AGENT_ENGINES, type ProjectSessionEngine } from '../../../../core/src/agentEngines.js';
import type { ProjectTreeNode } from '../../../../core/src/messages.js';
import type { AgentMenuRequest } from '../agentMenu.js';
import { CLOUD_OTHER_ID, parseCloudNodeId } from '../fleet/cloudNodes.js';
import { CloudFolderRows, type CloudSessionsProps, CloudSessionsSection } from '../fleet/CloudSessionsSection.js';
import { useAgentMenuGestures } from '../useAgentMenuGestures.js';
import { useNow } from '../useNow.js';
import { contextChip,type ContextTone } from './contextChip.js';
import { dismissEnded, readDismissed, withoutDismissed, writeDismissed } from './dismissedSessions.js';
import { ancestorOf, projectMenuContext } from './projectNodeTargets.js';
import { type ProjectStore, useProjectState } from './projectStore.js';
import {
  buildAgentTree,
  canMoveProjectNode,
  countSessions,
  filterProjectTree,
  isEndedNode,
  isRunningNode,
  isSelectedSession,
  isUnfinishedNode,
  type ProjectTreeBranch,
  recentlyStoppedSessions,
  selectedAncestorIds,
  sessionCode,
  sessionDisplayName,
  sessionFaceHue,
  sessionFaceMood,
  sessionProgressView,
  sessionSummary,
  stoppedLabel,
  type TreeSelection,
} from './projectTreeView.js';
import { SessionFace } from './SessionFace.js';
import { useSessionHover } from './sessionHover.js';
import { SessionHoverCard } from './SessionHoverCard.js';

const COLLAPSED_KEY = 'company.projectTree.collapsed.v1';
// Tools a user filters by. "herdr" is the terminal host every session runs in, not a tool, so it is not offered.
const AGENT_KINDS = [...AGENT_ENGINES.map((engine) => engine.id), 'sub', 'board'] as const;
const AGENT_KIND_CLASS: Readonly<Record<NonNullable<ProjectTreeNode['agentKind']>, string>> = {
  omp: 'text-accent',
  sub: 'text-warning',
  claude: 'text-status-active',
  agy: 'text-status-waiting',
  codex: 'text-accent',
  pi: 'text-accent',
  thinkrail: 'text-status-active',
  herdr: 'text-text-secondary',
  board: 'text-text',
};
const SESSION_STATE_LABEL: Readonly<Record<string, string>> = {
  running: 'đang chạy',
  working: 'đang chạy',
  active: 'đang chạy',
  busy: 'đang chạy',
  waiting: 'đang chờ',
  waiting_input: 'chờ bạn',
  blocked: 'chờ bạn',
  idle: 'rảnh',
  sleeping: 'ngủ',
  ended: 'đã tắt',
};
const STRUCTURE_ICON: Readonly<Partial<Record<ProjectTreeNode['kind'], string>>> = {
  project: '▰',
  group: '▸',
  folder: '📁',
  repository: '⎇',
};
const CONTEXT_TONE_CLASS: Readonly<Record<ContextTone, string>> = { calm: 'text-text-muted', warn: 'text-warning', error: 'text-status-error' };
/** Rows another folder or group can be dropped on. */
const DROP_KINDS: ReadonlySet<ProjectTreeNode['kind']> = new Set(['project', 'group', 'folder']);
/** Row text size by kind: Projects and folders read as headings, sessions one compact line each. */
const ROW_TEXT_CLASS: Readonly<Partial<Record<ProjectTreeNode['kind'], string>>> = {
  project: 'text-base',
  folder: 'text-base',
  session: 'text-sm',
};
/** Branches a session row leaves unsaid: most sessions work on one of them. */
const MAIN_BRANCHES: ReadonlySet<string> = new Set(['main', 'master']);
const NO_MENU = () => {};
/** How many sessions the "Vừa ngủ / tắt" list shows. */
const RECENT_STOPPED_MAX = 6;

function readCollapsed(): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = stored === null ? [] : JSON.parse(stored);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export interface ProjectTreeProps {
  nodes: readonly ProjectTreeNode[];
  selectedProjectId: string | null;
  store: ProjectStore;
  onSelectProject: (projectId: string | null) => void;
  /** "Tạo project": choose a folder in Windows' dialog; the new Project is named after it and holds it. */
  onCreateProject: () => void;
  onOpenChanges: (checkoutId: string, tab?: 'diff' | 'merge' | 'compare', branchA?: string) => void;
  onOpenSettings: (nodeId: string | null) => void;
  onNewSession: (nodeId: string, engine?: ProjectSessionEngine) => void;
  /** Opens a session row's terminal; the branch carries the Project folder it works under. */
  onOpenSession: (session: ProjectTreeNode, where: { readonly folderPath?: string }) => void;
  /** Opens a "Vừa ngủ / tắt" session's details: its prompts, its last answer, and its wake. */
  onOpenStopped: (session: ProjectTreeNode) => void;
  /** Opens the full list of every session that stopped, paged from the server; no button when absent. */
  onOpenStoppedHistory?: () => void;
  onMenu: (request: AgentMenuRequest) => void;
  /** The session the detail drawer shows; its row is highlighted and scrolled into view. */
  selection?: TreeSelection;
  /** The share of its context window a session row's agent has used (0–1); null or absent shows no chip. */
  contextOf?: (node: ProjectTreeNode) => number | null;
  /** Agents in tmux on cloud machines, listed under "Cloud"; absent when this connection may not see the fleet. */
  cloud?: CloudSessionsProps;
}

/** Sidebar: Project → groups → folders → repos → sessions, subagents under theirs. Git and files live on other pages. */
export function ProjectTree(props: ProjectTreeProps) {
  const { selectedProjectId, onSelectProject } = props;
  // Ended sessions the user cleared with "Dọn đã tắt": hidden here only, the server still reads them from the ledger.
  const [dismissed, setDismissed] = useState(readDismissed);
  const nodes = useMemo(() => withoutDismissed(props.nodes, dismissed), [props.nodes, dismissed]);
  const endedCount = useMemo(() => new Set(nodes.filter(isEndedNode).map((node) => node.sessionId ?? node.id)).size, [nodes]);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [agentKind, setAgentKind] = useState<ProjectTreeNode['agentKind'] | 'all'>('all');
  // Every open session shows by default: an idle omp pane is the user's own work, waiting for them.
  const [liveOnly, setLiveOnly] = useState(false);
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  // Ended sessions are history: the tree lists them only when asked for the unfinished ones.
  // A session that exited or fell asleep stays under its folder (marked "tắt"/"ngủ"): hiding it made the folder lose it.
  const tree = useMemo(() => buildAgentTree(nodes), [nodes]);
  const unfinishedCount = useMemo(() => new Set(nodes.filter(isUnfinishedNode).map((node) => node.sessionId ?? node.id)).size, [nodes]);
  // A refused create, rename, move or delete says why; before this it failed without a word.
  const { errors, treeComplete, treeStale } = useProjectState(props.store);
  const reposLoading = nodes.length > 0 && (!treeComplete || treeStale);
  const commandError = Object.entries(errors).find(([key, reason]) => key.startsWith('command:') && reason !== '')?.[1];
  const selectedRoots = selectedProjectId === null
    ? tree
    // The cloud group belongs to no Project: it stays whichever Project is chosen.
    : tree.filter((branch) => branch.node.id === selectedProjectId || branch.node.id === CLOUD_OTHER_ID);
  const visible = filterProjectTree(selectedRoots, { agentKind, liveOnly, unfinishedOnly, ...(props.selection === undefined ? {} : { keep: props.selection }) });
  // The drawer opened a session inside a folded folder: unfold the way down to its row, once per
  // session, so folding that folder again afterwards stays folded on later tree updates.
  const selection = props.selection;
  const selectionKey = `${selection?.sessionId ?? ''}|${selection?.paneId ?? ''}`;
  const unfoldedFor = useRef('');
  useEffect(() => {
    if (selection === undefined || unfoldedFor.current === selectionKey) return;
    const ancestors = selectedAncestorIds(nodes, selection);
    // The tree may not list the session yet: try again when it updates.
    if (ancestors.length === 0) return;
    unfoldedFor.current = selectionKey;
    setCollapsed((current) => (ancestors.some((id) => current.has(id)) ? new Set([...current].filter((id) => !ancestors.includes(id))) : current));
  }, [nodes, selection, selectionKey]);
  // A right-click "Phiên mới · … cloud" opens its request box under that node: unfold the node so the box shows.
  const cloudNodeId = props.cloud?.request?.nodeId;
  const cloudToken = props.cloud?.request?.token;
  useEffect(() => {
    if (cloudNodeId === undefined) return;
    setCollapsed((current) => (current.has(cloudNodeId) ? new Set([...current].filter((id) => id !== cloudNodeId)) : current));
  }, [cloudNodeId, cloudToken]);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage is optional in embedded and restricted browser contexts.
    }
  }, [collapsed]);

  const toggleCollapse = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const moveNode = (sourceId: string, target: ProjectTreeNode) => {
    if (!nodes.some((node) => node.id === sourceId) || !canMoveProjectNode(nodes, sourceId, target.id)) return;
    const source = nodes.find((node) => node.id === sourceId);
    const parentId = target.kind === 'project' || target.kind === 'group' ? target.id : target.parentId;
    const siblings = nodes.filter((node) => node.parentId === parentId);
    let index = target.kind === 'folder' ? siblings.findIndex((node) => node.id === target.id) : undefined;
    const sourceIndex = siblings.findIndex((node) => node.id === sourceId);
    if (index !== undefined && index < 0) return;
    if (index !== undefined && source?.parentId === parentId && sourceIndex >= 0 && sourceIndex < index) index -= 1;
    props.store.moveNode({ nodeId: sourceId, ...(parentId === undefined ? {} : { parentId }), ...(index === undefined ? {} : { index }) });
  };
  return (
    <nav aria-label="Dự án" className="flex min-h-0 flex-col gap-1 border-b border-hairline px-2 py-2">
      <div className="flex items-center gap-1">
        <button type="button" aria-pressed={selectedProjectId === null} onClick={() => onSelectProject(null)} className="touch-target min-w-0 flex-1 rounded px-2 text-left text-sm text-text-secondary aria-pressed:bg-selected">Tất cả dự án</button>
        <button type="button" aria-label="Tạo project" title="Tạo project từ một thư mục (mở hộp chọn thư mục của Windows)" onClick={props.onCreateProject} className="touch-target rounded px-2 text-text-secondary">➕</button>
      </div>
      {commandError !== undefined && <p role="alert" className="px-2 text-xs text-status-error">{commandError}</p>}
      {reposLoading && <p role="status" className="px-2 text-xs text-text-muted">Đang tải repo…</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-text-muted">
        <select aria-label="Lọc theo công cụ" value={agentKind} onChange={(event) => setAgentKind(event.target.value as ProjectTreeNode['agentKind'] | 'all')} className="min-w-28 flex-1 rounded bg-well px-1 py-1 text-sm text-text">
          <option value="all">Mọi công cụ</option>
          {AGENT_KINDS.map((kind) => <option key={kind} value={kind}>{AGENT_ENGINES.find((engine) => engine.id === kind)?.label ?? kind}</option>)}
        </select>
        <label className="flex items-center gap-1" title="Chỉ hiện phiên đang làm hoặc đang chờ bạn, ẩn phiên rảnh"><input type="checkbox" checked={liveOnly} onChange={(event) => setLiveOnly(event.target.checked)} />Ẩn phiên rảnh</label>
        <label className={`flex shrink-0 items-center gap-1 ${unfinishedCount > 0 ? 'text-warning' : ''}`} title="Chỉ hiện phiên làm dở: bị ngắt giữa chừng, hoặc đã dừng khi todo chưa xong (kể cả phiên đã tắt trong 24 giờ qua)"><input type="checkbox" checked={unfinishedOnly} onChange={(event) => setUnfinishedOnly(event.target.checked)} />Làm dở{unfinishedCount > 0 ? ` (${unfinishedCount})` : ''}</label>
        {endedCount > 0 && (
          <button
            type="button"
            className="shrink-0 rounded px-1 text-xs text-text-muted hover:bg-hover"
            title="Ẩn khỏi danh sách mọi phiên đã tắt (chỉ trên trình duyệt này); phiên chạy lại sẽ hiện lại"
            onClick={() => {
              const next = dismissEnded(props.nodes, dismissed, Date.now());
              writeDismissed(next);
              setDismissed(next);
            }}
          >
            Dọn đã tắt ({endedCount})
          </button>
        )}
      </div>
      <RecentlyStopped nodes={nodes} onOpenStopped={props.onOpenStopped} {...(props.onOpenStoppedHistory === undefined ? {} : { onOpenHistory: props.onOpenStoppedHistory })} onMenu={props.onMenu} cloud={props.cloud !== undefined} />
      <div className="min-h-0 overflow-y-auto">
        {visible.map((branch) => (
          <ProjectTreeRow key={branch.node.id} branch={branch} depth={0} collapsed={collapsed} onToggleCollapse={toggleCollapse} onMove={moveNode} {...props} />
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-3 text-xs text-text-muted">
            {nodes.length === 0 ? 'Đang tải dự án…' : 'Chưa có Project nào.'}
          </p>
        )}
        {props.cloud !== undefined && <CloudSessionsSection {...props.cloud} />}
      </div>
    </nav>
  );
}

/** "bị ngắt" (its last turn was cut off) or "dở" (it stopped with todo tasks left); nothing for a finished or working session. */
export function UnfinishedMark({ node, count = false }: { node: ProjectTreeNode; count?: boolean }) {
  if (!isUnfinishedNode(node)) return null;
  if (node.interrupted !== undefined) {
    return <span className="shrink-0 text-status-error" title={`Bị ngắt: ${node.interrupted}`}>bị ngắt</span>;
  }
  const left = count && node.progress !== undefined ? ` ${node.progress.done}/${node.progress.total}` : '';
  return <span className="shrink-0 text-warning" title="Agent đã dừng khi todo còn việc chưa xong">dở{left}</span>;
}

/** The sessions put to sleep or exited last, newest first: which one, how long ago, and whether it left work undone. */
function RecentlyStopped({ nodes, onOpenStopped, onOpenHistory, onMenu, cloud }: Pick<ProjectTreeProps, 'nodes' | 'onOpenStopped' | 'onMenu'> & { cloud: boolean; onOpenHistory?: () => void }) {
  const now = useNow();
  const [open, setOpen] = useState(true);
  const recent = useMemo(() => recentlyStoppedSessions(nodes, RECENT_STOPPED_MAX), [nodes]);
  // With the full list one click away the heading stays even when nothing stopped lately: older sessions are in there.
  if (recent.length === 0 && onOpenHistory === undefined) return null;
  return (
    <section aria-label="Vừa ngủ / tắt" className="flex flex-col">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="touch-target flex min-w-0 flex-1 items-center gap-1 rounded px-2 text-left text-xs font-semibold text-text-muted hover:bg-hover"
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>Vừa ngủ / tắt
        </button>
        {onOpenHistory !== undefined && (
          <button
            type="button"
            data-testid="stopped-history-open"
            onClick={onOpenHistory}
            title="Xem mọi phiên đã tắt hoặc ngủ, từ mới đến cũ"
            className="touch-target shrink-0 rounded px-2 text-2xs text-accent hover:bg-hover"
          >
            Xem tất cả
          </button>
        )}
      </div>
      {open && recent.map((node) => <RecentStoppedRow key={node.id} node={node} menuContext={projectMenuContext(nodes, node, cloud)} folder={ancestorOf(nodes, node, 'folder')?.name} now={now} onOpenStopped={onOpenStopped} onMenu={onMenu} />)}
    </section>
  );
}

/** One "Vừa ngủ / tắt" row with its session code; the pointer shows its card, a click opens its details. */
function RecentStoppedRow({ node, menuContext, folder, now, onOpenStopped, onMenu }: Pick<ProjectTreeProps, 'onOpenStopped' | 'onMenu'> & { node: ProjectTreeNode; menuContext: ReturnType<typeof projectMenuContext>; folder: string | undefined; now: number }) {
  const hover = useSessionHover(true);
  // Right-click: a board session gets its own menu (with Xoá phiên); a cloud or herdr one, the tree node's (Xoá phiên cloud / Xoá phiên).
  const menu = useAgentMenuGestures<HTMLButtonElement>(
    node.boardSessionId === undefined ? { kind: 'projectNode', node, menu: menuContext } : { kind: 'session', sessionId: node.boardSessionId, drawer: null },
    onMenu,
  );
  const label = stoppedLabel(node, now);
  const code = sessionCode(node);
  return (
    <>
      <button
        type="button"
        data-testid="recent-stopped-row"
        onClick={() => onOpenStopped(node)}
        {...hover.bind}
        {...menu}
        className="touch-target flex min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-hover"
      >
        <SessionFace mood={sessionFaceMood(node)} hue={sessionFaceHue(node.sessionId ?? node.id)} size="sm" {...(parseCloudNodeId(node.id) === null ? {} : { variant: 'cloud' as const })} />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-text">{sessionDisplayName(node)}</span>
          {/* A stopped session leaves its folder in the tree: name the folder here so it can be found. */}
          {folder !== undefined && <span className="block truncate text-2xs text-text-muted" data-testid="recent-stopped-folder">📁 {folder}</span>}
        </span>
        {code !== null && <span className="shrink-0 font-mono text-2xs text-text-muted" title={`Mã phiên ${code.full}`}>#{code.short}</span>}
        <UnfinishedMark node={node} count />
        <span className="shrink-0 text-2xs text-text-muted">{label}</span>
      </button>
      {hover.anchor !== null && <SessionHoverCard node={node} anchor={hover.anchor} {...(label === null ? {} : { stateLabel: label })} running={false} />}
    </>
  );
}

interface ProjectTreeRowProps extends ProjectTreeProps {
  branch: ProjectTreeBranch;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  onMove: (sourceId: string, target: ProjectTreeNode) => void;
}

function ProjectTreeRow({ branch, depth, collapsed, onToggleCollapse, onMove, ...props }: ProjectTreeRowProps) {
  const { node, children } = branch;
  const isCollapsed = collapsed.has(node.id);
  const menuSubject = useMemo(
    () => ({ kind: 'projectNode' as const, node, menu: projectMenuContext(props.nodes, node, props.cloud !== undefined) }),
    [node, props.nodes, props.cloud],
  );
  // A cloud group has no server node behind it: no menu, no drag, no rename or new-session button.
  const isCloudGroup = node.id === CLOUD_OTHER_ID;
  const menu = useAgentMenuGestures<HTMLButtonElement>(menuSubject, isCloudGroup ? NO_MENU : props.onMenu);
  const isSession = node.kind === 'session';
  const cloudHome = isSession ? parseCloudNodeId(node.id) : null;
  // A subagent is its parent's little helper: a mini face and one line, with no card of its own.
  const isSub = isSession && node.agentKind === 'sub';
  const selected = isSession && props.selection !== undefined && isSelectedSession(node, props.selection);
  const stateLabel = node.state === undefined ? undefined : (SESSION_STATE_LABEL[node.state.toLowerCase()] ?? node.state);
  const context = isSession && !isSub ? contextChip(props.contextOf?.(node) ?? null) : null;
  const agentEngine = node.agentKind === undefined ? undefined : AGENT_ENGINES.find((engine) => engine.id === node.agentKind);
  const rowRef = useRef<HTMLButtonElement>(null);
  // The drawer just opened this session: bring its row into view so you see where it sits.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const receivesDrop = !isCloudGroup && DROP_KINDS.has(node.kind);
  const counts = isSession ? null : countSessions(branch);
  const progress = isSession ? sessionProgressView(node.progress) : null;
  const hover = useSessionHover(isSession);
  const hoverCheckout = hover.anchor === null ? undefined : props.nodes.find((candidate) => candidate.id === node.parentId && candidate.kind === 'checkout');
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!receivesDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };
  return (
    <div>
      <div
        draggable={!isCloudGroup && (node.kind === 'folder' || node.kind === 'group')}
        onDragStart={(event) => event.dataTransfer.setData('text/plain', node.id)}
        onDragOver={onDragOver}
        onDrop={(event) => {
          if (!receivesDrop) return;
          event.preventDefault();
          event.stopPropagation();
          onMove(event.dataTransfer.getData('text/plain'), node);
        }}
        className={`group flex min-w-0 items-center gap-1 rounded-(--company-radius-sm) ${isSession ? 'my-0.5' : 'hover:bg-hover'}`}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          ref={rowRef}
          aria-current={selected ? 'true' : undefined}
          type="button"
          aria-label={`${node.kind}: ${isSession ? sessionDisplayName(node) : node.name}`}
          title={isSession ? undefined : node.path ?? node.name}
          onClick={() => {
            // No chevron column (it took a fixed 24px per row): the row name toggles. A project selects on the
            // first click and collapses when clicked again while selected.
            if (node.kind === 'project') {
              if (props.selectedProjectId === node.id && children.length > 0) onToggleCollapse(node.id);
              else {
                props.onSelectProject(node.id);
                if (isCollapsed) onToggleCollapse(node.id);
              }
            } else if (isSession) props.onOpenSession(node, branch);
            else onToggleCollapse(node.id);
          }}
          aria-expanded={children.length > 0 && !isSession ? !isCollapsed : undefined}
          {...menu}
          {...hover.bind}
          className={`touch-target flex min-w-0 flex-1 items-center text-left ${ROW_TEXT_CLASS[node.kind] ?? 'text-sm'} ${(node.kind === 'project' && props.selectedProjectId === node.id) || selected ? 'bg-selected text-text' : 'text-text-secondary'} ${
            isSession
              // A session is a chip, as an agent is in ZCode: room around a bigger face, a soft card behind it.
              ? isSub
                ? `gap-1.5 rounded-md border px-1.5 py-0.5 text-xs transition-colors duration-150 ${selected ? 'border-accent/50' : 'border-transparent hover:bg-hover'}`
                : `gap-2.5 rounded-lg border px-2 py-1.5 transition-colors duration-150 ${selected ? 'border-accent/50' : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-hover'}`
              : 'gap-2 rounded px-1 py-0.5'
          }`}
        >
          {isSession ? (
            <>
              <SessionFace mood={sessionFaceMood(node)} hue={sessionFaceHue(node.sessionId ?? node.id)} size={isSub ? 'sm' : 'lg'} {...(cloudHome === null ? {} : { variant: 'cloud' as const })} />
              <span className="min-w-0 flex-1 leading-snug">
                {/* One line: the name, then only what a glance needs. A running session's face glances around ("đang chạy"); main is the usual branch. */}
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-text">{sessionDisplayName(node)}</span>
                  <span className="max-w-[45%] shrink-0 truncate text-2xs text-text-muted">
                    {/* Every session runs inside herdr, so "herdr" names no tool: show the tool only when it is known. */}
                    {[
                      cloudHome === null ? null : <span key="cloud" className="font-mono" title={`Chạy trên máy cloud ${cloudHome.machine}`}><span aria-hidden="true">☁ </span><span className="sr-only">cloud </span>{cloudHome.machine}</span>,
                      node.agentKind !== undefined && node.agentKind !== 'herdr'
                        ? <span key="kind" className={AGENT_KIND_CLASS[node.agentKind]}>{agentEngine === undefined ? node.agentKind : `${agentEngine.icon} ${agentEngine.label}`}</span>
                        : null,
                      !isRunningNode(node) && stateLabel !== undefined ? stateLabel : null,
                      children.length > 0 ? `+${children.length}` : null,
                      context === null ? null : <span key="ctx" className={CONTEXT_TONE_CLASS[context.tone]} title="Phần cửa sổ context đã dùng">{context.text}</span>,
                      isUnfinishedNode(node) ? <UnfinishedMark key="left" node={node} /> : null,
                      branch.where !== undefined && !MAIN_BRANCHES.has(branch.where) ? branch.where : null,
                    ].filter((part) => part !== null).flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
                  </span>
                </span>
                {!isSub && progress === null && sessionSummary(node) !== undefined && (
                  <span className="block truncate text-xs text-text-muted" data-testid="session-summary">{sessionSummary(node)}</span>
                )}
                {!isSub && progress !== null && (
                  <span className="mt-1 block" data-testid="session-progress" title={[progress.current && `Đang: ${progress.current}`, progress.blocked && `Kẹt: ${progress.blocked}`].filter(Boolean).join('\n')}>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-well">
                        <span className="block h-full rounded-full bg-status-success" style={{ width: `${progress.percent}%` }} />
                      </span>
                      <span className="shrink-0">{progress.label}</span>
                    </span>
                    {progress.blocked !== undefined ? (
                      <span className="block truncate text-xs text-status-error">Kẹt: {progress.blocked}</span>
                    ) : progress.current !== undefined && (
                      <span className="block truncate text-xs text-text-muted">Đang: {progress.current}</span>
                    )}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true" className="shrink-0 text-text-muted">{STRUCTURE_ICON[node.kind] ?? '·'}</span>
              <span className={`min-w-0 flex-1 truncate ${node.kind === 'project' || node.kind === 'folder' ? 'font-semibold text-text' : 'font-medium'}`}>{node.name}</span>
              {counts !== null && counts.total > 0 && (
                <span className="shrink-0 text-xs text-text-muted" title={`${counts.running} đang chạy / ${counts.total} phiên`}>
                  {counts.running > 0 ? counts.running : counts.total}
                </span>
              )}
            </>
          )}
        </button>
        {!isCloudGroup && (node.kind === 'project' || node.kind === 'group' || node.kind === 'folder') && (
          <button
            type="button"
            aria-label={`Thao tác với ${node.name}`}
            title="Đổi tên, xoá… (hoặc chuột phải)"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              props.onMenu({ subject: menuSubject, anchor: { x: rect.left, y: rect.bottom }, returnFocus: event.currentTarget });
            }}
            className="touch-target shrink-0 rounded px-1.5 text-base text-text-muted hover:bg-hover hover:text-text"
          >
            ⋯
          </button>
        )}
        {node.kind === 'folder' && (
          <button
            type="button"
            aria-label={`Phiên mới trong ${node.name}`}
            title="Phiên mới trong thư mục này (chuột phải để chọn omp / Claude / agy)"
            onClick={() => props.onNewSession(node.id)}
            className="touch-target shrink-0 rounded px-1.5 text-base text-text-muted hover:bg-hover hover:text-text"
          >
            +
          </button>
        )}
      </div>
      {/* A session's sub-agents always show: its row opens the session, so it has no collapse gesture left. */}
      {(!isCollapsed || isSession) && children.map((child) => (
        <ProjectTreeRow key={child.node.id} branch={child} depth={depth + 1} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onMove={onMove} {...props} />
      ))}
      {/* Cloud sessions started from this node sit under it like its local sessions. */}
      {!isCollapsed && !isSession && !isCloudGroup && props.cloud !== undefined && <CloudFolderRows {...props.cloud} nodeId={node.id} depth={depth + 1} />}
      {hover.anchor !== null && (
        <SessionHoverCard
          node={node}
          anchor={hover.anchor}
          {...(branch.where === undefined || MAIN_BRANCHES.has(branch.where) ? {} : { where: branch.where })}
          {...(hoverCheckout === undefined ? {} : { checkout: hoverCheckout })}
          {...(stateLabel === undefined ? {} : { stateLabel })}
          running={isRunningNode(node)}
        />
      )}
    </div>
  );
}
