/**
 * BoardShell: the whole Company surface, a full-screen board for runs on OMP.
 *
 * It owns the state the surfaces share: the subject the drawer shows, the artifact
 * a file view opened, the remembered shapes of the sidebar and the drawer, the
 * herdr tab, the folds of the project tree, and the one context menu. Every
 * action a row, card, drawer header or project header offers lives in that
 * menu; the surfaces keep only their content controls.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectTreeNode } from '../../../../core/src/messages.js';
import { cloudAgentCards } from '../agentBoard.js';
import type { AgentMenuRequest, ProjectNodeAction, WorkItemMenuAction } from '../agentMenu.js';
import { boardFlow, buildBoardLanes, planningPrompts } from '../boardView.js';
import { buildPaletteItems, type PaletteActionId, type PaletteItem } from '../commandPalette.js';
import type { CompanyClient } from '../companyClient.js';
import type { CompanyDrawerTab, CompanyViewState } from '../companyState.js';
import { startNewChat } from '../composerRouting.js';
import {
  COMPANY_NAV_MOBILE_MAX_PX,
  COMPANY_PAGE_TRANSITION_MS,
  COMPANY_RAIL_WIDTH_PX,
} from '../constants.js';
import { type DrawerPrefs, readDrawerPrefs, writeDrawerPrefs } from '../drawerPrefs.js';
import { readDrawerTabPrefs, writeDrawerTabPrefs } from '../drawerTabPrefs.js';
import { settleCleaned } from '../fleet/cloudClean.js';
import { cloudFolderKey, type CloudFolders, readCloudFolders, writeCloudFolders } from '../fleet/cloudFolders.js';
import { sendCloudLine } from '../fleet/cloudInput.js';
import { cloudNodeId, cloudTreeNodes, parseCloudNodeId, pausedMachineNotice, readCloudSeen, rememberCloud, writeCloudSeen } from '../fleet/cloudNodes.js';
import { pendingCloudRow } from '../fleet/cloudRows.js';
import { randomSuffix, slugFromPrompt } from '../fleet/cloudTaskPick.js';
import { FLEET_ACTION_LABEL } from '../fleet/fleetActionLabel.js';
import { fleetStore } from '../fleet/fleetClient.js';
import { useFleetState } from '../fleet/fleetStore.js';
import { type CloudRequest, FleetView } from '../fleet/FleetView.js';
import { GuardView } from '../fleet/GuardView.js';
import { folderIdentityOf, foldersWaitingForSnapshot, showsAllFolders } from '../folderIdentity.js';
import { openPickedFolder, pickFolder } from '../folderPick.js';
import { folderBasename, type FolderFocusInput } from '../folderView.js';
import type { HerdrDrawerTab } from '../herdrView.js';
import type { IconName } from '../iconNames.js';
import { sidebarPresentation } from '../layoutMode.js';
import { ledgerStore } from '../ledger/ledgerClient.js';
import { panesOf } from '../ledger/ledgerManagers.js';
import { boardSessionIndex } from '../ledger/ledgerMapping.js';
import { useLedgerState } from '../ledger/ledgerStore.js';
import { LedgerView } from '../ledger/LedgerView.js';
import { AccountsPage } from '../library/AccountsPage.js';
import { McpPage } from '../library/McpPage.js';
import { SkillsPage } from '../library/SkillsPage.js';
import { StoragePage } from '../library/StoragePage.js';
import { ChangesPage } from '../projects/ChangesPage.js';
import { contextOfNode } from '../projects/contextChip.js';
import { LayeredSettingsDialog } from '../projects/LayeredSettingsDialog.js';
import { NewSessionDialog } from '../projects/NewSessionDialog.js';
import { projectBusyLabel } from '../projects/projectBusy.js';
import { projectStore } from '../projects/projectClient.js';
import {
  ancestorOf,
  checkoutPathFor,
  cloudEngineForAction,
  engineForAction,
  paneCheckouts,
  type ProjectSessionEngine,
  sessionChanges,
} from '../projects/projectNodeTargets.js';
import { useProjectState, waitForProjectCreate } from '../projects/projectStore.js';
import { isEndedNode } from '../projects/projectTreeView.js';
import { StoppedSessionDialog } from '../projects/StoppedSessionDialog.js';
import { COMPANY_ROLES, roleProfile } from '../roleProfiles.js';
import { startScrollFades } from '../scrollFades.js';
import {
  type DrawerSubject,
  drawerSubjectFor,
  herdrPaneHidden,
  type OpenedSubject,
  pendingContract,
  selectionForSession,
  selectionForTask,
} from '../selection.js';
import { findShortcutId, matchShortcut } from '../shortcuts.js';
import {
  clampSidebarWidth,
  isTypingTarget,
  readSidebarPrefs,
  type SidebarPrefs,
  toggleProjectKey,
  writeSidebarPrefs,
} from '../sidebarPrefs.js';
import { useCompanyState } from '../useCompanyState.js';
import { useLayoutMode } from '../useLayoutMode.js';
import { useSessionLogBackfill } from '../useSessionLogBackfill.js';
import { closeUsagePage, openUsagePage, useUsageRoute } from '../useUsageRoute.js';
import { workItemCardTarget, workItemsOf } from '../workItemView.js';
import { AgentContextMenu } from './AgentContextMenu.js';
import { AgentRail } from './AgentRail.js';
import { AgentSessionsPage } from './AgentSessionsPage.js';
import { AgentSidebar } from './AgentSidebar.js';
import { AttentionBar } from './AttentionBar.js';
import { BoardTopBar } from './BoardTopBar.js';
import { BusyNote } from './BusyNote.js';
import { CommandPalette } from './CommandPalette.js';
import { CompanyBoard } from './CompanyBoard.js';
import { DetailDrawer } from './DetailDrawer.js';
import { Icon } from './Icon.js';
import { OpenSpecPage } from './OpenSpecPage.js';
import { PromptComposer } from './PromptComposer.js';
import { RolesDialog } from './RolesDialog.js';
import { ShortcutsSheet } from './ShortcutsSheet.js';
import { TerminalPreviewProvider } from './TerminalPreview.js';
import { UsagePage } from './usage/UsagePage.js';
import { WorkDialogHost, type WorkDialogRequest } from './WorkDialogHost.js';

/**
 * The webview's localStorage, or null when the host refuses access to it. A
 * refused store means the sidebar and the drawer simply do not remember their shape.
 */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type ShellPage =
  | 'board'
  | 'ledger'
  | 'sessions'
  | 'cloud'
  | 'guard'
  | 'usage'
  | 'storage'
  | 'skills'
  | 'mcp'
  | 'accounts'
  | 'changes'
  | 'openspec';
const FLEET_REFRESH_INTERVAL_MS = 15_000;

/** Apple platforms show ⌘ in shortcut hints; elsewhere the key names stay. */
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * The words of the snapshot banner. In all mode it names the folders still waiting for a fresh
 * snapshot, so the reader knows which folder's board may be behind.
 */
function snapshotNoticeText(state: CompanyViewState): string {
  const waiting = showsAllFolders(state) ? foldersWaitingForSnapshot(state) : [];
  if (waiting.length === 0) {
    return 'Có thay đổi đã bị bỏ sót; đang chờ một bản chụp mới từ máy chủ.';
  }
  return `Có thay đổi đã bị bỏ sót ở ${waiting.join(', ')}; đang chờ một bản chụp mới từ máy chủ.`;
}

/** The Project already holding `folderPath`, if any: a refused create shows where that folder is. */
function projectHoldingFolder(nodes: readonly ProjectTreeNode[], folderPath: string): string | undefined {
  const key = (value: string): string => value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const folder = nodes.find((node) => node.kind === 'folder' && node.path !== undefined && key(node.path) === key(folderPath));
  return folder === undefined ? undefined : ancestorOf(nodes, folder, 'project')?.id;
}

export interface BoardShellProps {
  client: CompanyClient;
}

export function BoardShell({ client }: BoardShellProps) {
  const projects = useProjectState(projectStore);
  const projectBusy = projectBusyLabel(Object.values(projects.pending));
  const paneCheckout = useMemo(() => paneCheckouts(projects.nodes), [projects.nodes]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSettingsNode, setProjectSettingsNode] = useState<string | null>(null);
  const [newSessionNode, setNewSessionNode] = useState<{ nodeId: string; engine?: ProjectSessionEngine } | null>(null);
  const [cloudRequest, setCloudRequest] = useState<CloudRequest | null>(null);
  // Which tree node started each cloud session, so it sits under that node like a local session.
  const [cloudFolders, setCloudFolders] = useState<CloudFolders>(readCloudFolders);
  // The cloud sessions this browser has seen, so one whose tmux session is gone shows asleep like a local one.
  const [cloudSeen, setCloudSeen] = useState(readCloudSeen);
  /** The "Vừa ngủ / tắt" session whose details are open, to be woken from there. */
  const [stoppedNode, setStoppedNode] = useState<ProjectTreeNode | null>(null);
  const [selectedCheckoutId, setSelectedCheckoutId] = useState('');
  const [changesTab, setChangesTab] = useState<'diff' | 'merge' | 'compare'>('diff');
  const [compareBranchA, setCompareBranchA] = useState('');
  const state = useCompanyState(client);
  useSessionLogBackfill(client, state);
  const ledger = useLedgerState(ledgerStore);
  const fleet = useFleetState(fleetStore);
  const refreshFleet = useCallback(() => void fleetStore.requestFleet(), []);
  const usageRouteOpen = useUsageRoute();
  const [activePage, setActivePage] = useState<ShellPage>(() => usageRouteOpen ? 'usage' : 'board');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(
    () => window.matchMedia(`(max-width: ${COMPANY_NAV_MOBILE_MAX_PX}px)`).matches,
  );
  const ledgerShown = activePage === 'ledger' && ledger.privileged === true;
  const ledgerAvailable = ledger.privileged === true;
  const fleetAvailable = fleet.privileged === true;
  const fleetMachines = fleet.snapshot?.machines;
  const pendingCloud = useMemo(() => pendingCloudRow(fleet, fleetMachines ?? []), [fleet, fleetMachines]);
  // Cloud agents join the Project tree as session rows, so they look and sort like the local ones.
  // Tasks the machine removed stay out of the tree until its own reports stop naming them.
  const [cleanedCloud, setCleanedCloud] = useState<ReadonlyMap<string, number>>(() => new Map());
  const treeNodes = useMemo(
    () => {
      if (!fleetAvailable) return projects.nodes;
      const cloud = cloudTreeNodes({ machines: fleetMachines ?? [], folders: cloudFolders, nodes: projects.nodes, seen: cloudSeen, pending: pendingCloud }).filter((node) => {
        const ref = parseCloudNodeId(node.id);
        return ref === null || !cleanedCloud.has(cloudFolderKey(ref.machine, ref.session));
      });
      return [...projects.nodes, ...cloud];
    },
    [fleetAvailable, projects.nodes, fleetMachines, cloudFolders, cloudSeen, pendingCloud, cleanedCloud],
  );
  useEffect(() => {
    if (!fleetAvailable || fleetMachines === undefined) return;
    const next = rememberCloud(cloudSeen, fleetMachines, cloudFolders, projects.nodes, Date.now());
    if (next === cloudSeen) return;
    setCloudSeen(next);
    writeCloudSeen(next);
  }, [fleetAvailable, fleetMachines, cloudFolders, projects.nodes, cloudSeen]);
  const sessionsAvailable = ledgerAvailable || fleetAvailable;
  const redGuardCount = [
    ...(fleet.snapshot?.localGuard?.risks ?? []),
    ...(fleet.snapshot?.machines.flatMap((machine) => machine.guard?.risks ?? []) ?? []),
  ].filter((risk) => risk.level === 'red').length;
  const [opened, setOpened] = useState<OpenedSubject | null>(null);
  // The cloud session the drawer shows, once its terminal is attached: the composer types into it.
  const attachedTerminal = fleet.terminal;
  const cloudTarget = useMemo(
    () => {
      const shown = drawerSubjectFor(state, opened);
      return shown?.kind === 'cloud' && attachedTerminal !== null && attachedTerminal.machine === shown.machine && attachedTerminal.session === shown.session
        ? { label: `${shown.machine} · ${shown.session}`, send: (text: string) => sendCloudLine(attachedTerminal.terminalId, text) }
        : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` changes on every board message; only the selection decides the drawer subject
    [opened, attachedTerminal, state.selection],
  );
  // Why a session clicked in the tree opened nothing: it runs outside herdr, so there is no pane.
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // The paused cloud machine a clicked sleeping row sits on: its notice offers a button that starts it.
  const [pausedMachine, setPausedMachine] = useState<string | null>(null);
  const wakeInFlight = useRef<string | null>(null);
  useEffect(() => {
    if (fleet.action?.kind === 'wake') {
      wakeInFlight.current = fleet.action.machine;
      return;
    }
    const machine = wakeInFlight.current;
    if (machine === null || fleet.action !== null) return;
    wakeInFlight.current = null;
    setPausedMachine(null);
    setSessionNotice(
      fleet.actionError !== null
        ? `Không bật được máy ${machine}: ${fleet.actionError}`
        : `Đã gửi lệnh bật máy ${machine}. Máy báo lại sau khoảng 1–3 phút, rồi bấm lại phiên.`,
    );
  }, [fleet.action, fleet.actionError]);
  // A removed cloud task: hide it, close its drawer, and read the fleet again.
  const handledCleaned = useRef<typeof fleet.cleanedTask>(null);
  useEffect(() => {
    const cleaned = fleet.cleanedTask;
    if (cleaned === null || cleaned === handledCleaned.current) return;
    handledCleaned.current = cleaned;
    setCleanedCloud((current) => new Map(current).set(cloudFolderKey(cleaned.machine, cleaned.session), Date.now()));
    setOpened((current) => (current?.kind === 'cloud' && current.machine === cleaned.machine && current.session === cleaned.session ? null : current));
    refreshFleet();
  }, [fleet.cleanedTask, refreshFleet]);
  // The machine's refusal (unsaved work) has no page to show on: say it here.
  const cleanInFlight = useRef<{ machine: string; session: string } | null>(null);
  // Set when the machine refused only because commits exist nowhere else: the notice then offers to push the branch and clean.
  const [pushableClean, setPushableClean] = useState<{ machine: string; session: string } | null>(null);
  useEffect(() => {
    if (fleet.action?.kind === 'clean') {
      cleanInFlight.current = { machine: fleet.action.machine, session: fleet.action.session };
      setPushableClean(null);
      return;
    }
    const cleaning = cleanInFlight.current;
    if (cleaning === null || fleet.action !== null) return;
    cleanInFlight.current = null;
    if (fleet.actionError === null) return;
    setSessionNotice(`Không xoá được phiên cloud: ${fleet.actionError}`);
    if (fleet.actionError.includes('commit chua push')) setPushableClean(cleaning);
  }, [fleet.action, fleet.actionError]);
  // A delete or move the server refused (or never answered) used to fail without a word: say so once per failure.
  const shownProjectFailure = useRef('');
  useEffect(() => {
    const failed = Object.entries(projects.errors).find(([key, reason]) => reason !== '' && (key.startsWith('command:delete:') || key.startsWith('command:move:')));
    if (failed === undefined) return;
    const signature = `${failed[0]}|${failed[1]}`;
    if (shownProjectFailure.current === signature) return;
    shownProjectFailure.current = signature;
    setSessionNotice(`${failed[0].startsWith('command:delete:') ? 'Không xóa được' : 'Không di chuyển được'}: ${failed[1]}`);
  }, [projects.errors]);
  // Once the machine no longer names a removed task (or the hide time is up), forget it for good, remembered sleeping row included.
  useEffect(() => {
    if (cleanedCloud.size === 0 || fleetMachines === undefined) return;
    const { remaining, settled } = settleCleaned(cleanedCloud, fleetMachines, Date.now());
    if (settled.length === 0) return;
    setCleanedCloud(remaining);
    const kept = Object.fromEntries(Object.entries(cloudSeen).filter(([key]) => !settled.includes(key)));
    setCloudSeen(kept);
    writeCloudSeen(kept);
  }, [cleanedCloud, fleetMachines, cloudSeen]);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => readSidebarPrefs(browserStorage()));
  // A phone's sidebar sheet starts closed and is not remembered; other layouts keep the saved pref.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerPrefs, setDrawerPrefs] = useState<DrawerPrefs>(() =>
    readDrawerPrefs(browserStorage()),
  );
  const [tabPrefs, setTabPrefs] = useState(() => readDrawerTabPrefs(browserStorage()));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [herdrTab, setHerdrTab] = useState<HerdrDrawerTab>('screen');
  const [menu, setMenu] = useState<(AgentMenuRequest & { token: number }) | null>(null);
  // Each open gets a new token, so the menu remounts and starts from its first view.
  const openMenu = useCallback((request: AgentMenuRequest) => {
    setMenu((current) => ({ ...request, token: (current?.token ?? 0) + 1 }));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  function runWorkItemMenuAction(
    ref: { id: string; workspacePath: string },
    action: WorkItemMenuAction,
  ): void {
    setOpened({ kind: 'workItem', ...ref });
    if (action === 'open') return;
    setWorkItemAction((current) => ({
      ref,
      action,
      token: (current?.token ?? 0) + 1,
    }));
  }
  const [workDialog, setWorkDialog] = useState<WorkDialogRequest | null>(null);
  const [workItemAction, setWorkItemAction] = useState<{
    ref: { id: string; workspacePath: string };
    action: Exclude<WorkItemMenuAction, 'open'>;
    token: number;
  } | null>(null);
  const mode = useLayoutMode();

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${COMPANY_NAV_MOBILE_MAX_PX}px)`);
    const update = () => setMobileViewport(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (usageRouteOpen) setActivePage('usage');
    else setActivePage((page) => page === 'usage' ? 'board' : page);
  }, [usageRouteOpen]);

  useEffect(() => {
    if (!ledgerAvailable && activePage === 'ledger') setActivePage('board');
  }, [activePage, ledgerAvailable]);

  useEffect(() => {
    if (!sessionsAvailable && activePage === 'sessions') setActivePage('board');
  }, [activePage, sessionsAvailable]);

  useEffect(() => {
    if (activePage === 'openspec' && ledgerAvailable) ledgerStore.requestOpenSpec();
  }, [activePage, ledgerAvailable, ledger.connection]);

  useEffect(() => {
    if (!fleetAvailable) return undefined;
    // A hidden tab asks for nothing: every snapshot makes the server peek cloud machines over `instabox exec`.
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void fleetStore.requestFleet();
    };
    refresh();
    const timer = window.setInterval(refresh, FLEET_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fleetAvailable]);

  useEffect(() => {
    if ((!fleetAvailable && (activePage === 'cloud' || activePage === 'guard')) || (!ledgerAvailable && activePage === 'openspec')) {
      setActivePage('board');
    }
  }, [activePage, fleetAvailable, ledgerAvailable]);

  // A right-click agent choice applies once: leaving the Cloud page forgets it, so coming back keeps the reader's own pick.
  useEffect(() => {
    if (activePage !== 'cloud') setCloudRequest(null);
  }, [activePage]);

  // A cloud task opens in the drawer as soon as the machine has created it, like a new local session; each
  // created task is handled once, so closing the drawer does not bring it back.
  const handledCloudTask = useRef<typeof fleet.createdTask>(null);
  useEffect(() => {
    const created = fleet.createdTask;
    if (created === null || created === handledCloudTask.current) return;
    handledCloudTask.current = created;
    setOpened({ kind: 'cloud', machine: created.machine, session: created.session });
    refreshFleet();
  }, [fleet.createdTask, refreshFleet]);

  useEffect(() => {
    if (!mobileNavOpen || !mobileViewport) return undefined;
    function closeOnEscape(event: KeyboardEvent): void {
      if (matchShortcut('board.escape', event)) setMobileNavOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen, mobileViewport]);

  function selectPage(page: ShellPage): void {
    if (page === 'usage') {
      if (!usageRouteOpen) openUsagePage();
    } else if (usageRouteOpen) {
      closeUsagePage();
    }
    if ((page === 'cloud' || page === 'guard') && !fleetAvailable) return;
    if (page === 'sessions' && !sessionsAvailable) return;
    if (
      page !== 'board' &&
      page !== 'usage' &&
      page !== 'cloud' &&
      page !== 'guard' &&
      page !== 'sessions' &&
      !ledgerAvailable
    )
      return;
    setActivePage(page);
    setMobileNavOpen(false);
    setOpened(null);
  }

  function toggleActiveLedgerPage(): void {
    selectPage(activePage === 'ledger' ? 'board' : 'ledger');
  }
  // The keydown listener below is registered once per ledger availability; it reads the
  // current toggle through this ref so it never acts on a stale active page.
  const toggleLedgerRef = useRef(toggleActiveLedgerPage);
  toggleLedgerRef.current = toggleActiveLedgerPage;
  const sidebarCollapsed = mode === 'phone' ? !sheetOpen : prefs.collapsed;
  const sidebar = sidebarPresentation(mode, sidebarCollapsed);
  // The width the sidebar (or its rail) takes in the row beside the board. A sidebar that
  // floats over the board, or is a phone's sheet, takes none.
  let sidebarFootprint = 0;
  if (sidebar === 'docked') {
    sidebarFootprint = prefs.width;
  } else if (sidebar === 'rail') {
    sidebarFootprint = COMPANY_RAIL_WIDTH_PX;
  }
  const collapsedProjects = useMemo(
    () => new Set(prefs.collapsedProjects),
    [prefs.collapsedProjects],
  );

  const lanes = useMemo(() => buildBoardLanes(state, cloudAgentCards(treeNodes)), [state, treeNodes]);
  const squadPath = state.settings?.workspacePath ?? null;
  const squadFolder =
    squadPath === null
      ? null
      : {
          workspacePath: squadPath,
          settings: workItemsOf(state, squadPath).settings,
          claudeStatus: workItemsOf(state, squadPath).claudeStatus,
          claudeMcpServers: workItemsOf(state, squadPath).claudeMcpServers,
        };
  const ledgerBoardSessions = useMemo(() => boardSessionIndex(state.sessions), [state.sessions]);
  const ledgerPanes = useMemo(
    () => panesOf(state.herdr.agents, state.herdr.sleeping),
    [state.herdr.agents, state.herdr.sleeping],
  );
  // The folder rules' input for the Cây git view: folder mode scopes it to the folder in view.
  const ledgerFocus = useMemo<FolderFocusInput>(
    () => ({ viewMode: state.viewMode, focusPath: state.focusPath, workspaces: state.workspaces }),
    [state.viewMode, state.focusPath, state.workspaces],
  );
  // The Project tree's folders: Cây git narrows to one of them, or to all of them.
  const ledgerFolders = useMemo(
    () => projects.nodes.flatMap((node) => (node.kind === 'folder' && node.path !== undefined ? [{ name: node.name, path: node.path }] : [])),
    [projects.nodes],
  );
  const pendingQuestions = useMemo(
    () => Object.values(state.questions).filter((question) => question.status === 'pending'),
    [state.questions],
  );

  // The palette's rows are built only while it is open: file listings can run long.
  const paletteItems = useMemo(
    () =>
      paletteOpen
        ? buildPaletteItems(state, {
            activePath: state.settings?.workspacePath ?? null,
            folders: (state.workspaces ?? []).map((entry) => entry.path),
          })
        : [],
    [paletteOpen, state],
  );
  const subject: DrawerSubject | null = drawerSubjectFor(state, opened);
  // A phone's full-screen drawer that has an input of its own (a sleeping pane, a question)
  // takes the place of the board composer, so each screen has one input. A herdr pane has
  // none: the board composer is how a prompt reaches it, on a phone as everywhere else.
  const composerHidden =
    mode === 'phone' && (subject?.kind === 'sleeping' || subject?.kind === 'question');
  const selectedSessionId =
    subject?.kind === 'session' || subject?.kind === 'task' ? state.selection.sessionId : null;
  const selectedPaneId =
    subject?.kind === 'herdr' || subject?.kind === 'sleeping' ? subject.paneId : null;
  const selectedWorkItem =
    subject?.kind === 'workItem' ? { id: subject.id, workspacePath: subject.workspacePath } : null;
  const selectedSquad =
    subject?.kind === 'squad'
      ? { runId: subject.runId, workspacePath: subject.workspacePath }
      : null;
  // A folder switch settles the selection and drops a pane picked a moment before it landed, which
  // left the drawer showing the pane while the composer had nowhere to send. Pick it again, only
  // while nothing else is selected, so a session the user chose since is never overridden.
  const selectionEmpty =
    state.selection.herdrPaneId === null && state.selection.sessionId === null && state.selection.taskId === null;
  useEffect(() => {
    if (selectedPaneId !== null && selectionEmpty) client.select({ herdrPaneId: selectedPaneId });
  }, [client, selectedPaneId, selectionEmpty]);
  // A wake answers with the pane the session now runs in and picks it. The drawer still shows the
  // sleep record, which the wake removed ("không còn trong herdr"): turn it to that pane's screen.
  const pickedPane = state.selection.herdrPaneId;
  useEffect(() => {
    if (opened?.kind !== 'sleeping' || pickedPane === null || pickedPane === opened.paneId) return;
    setOpened({ kind: 'herdr', paneId: pickedPane, starting: true });
    setHerdrTab('screen');
  }, [opened, pickedPane]);

  // Diagnostics are a live measurement of processes the user owns: asked for
  // once the board is on screen, never polled in the background.
  useEffect(() => {
    if (activePage === 'board') client.requestDiagnostics();
  }, [activePage, client]);

  // Scroll areas draw no scrollbar; an edge with more content beyond it fades instead.
  useEffect(() => startScrollFades(), []);

  // The sidebar's and the drawer's shapes are remembered across reloads, so each
  // is written whenever it changes. A refused store only means it is not remembered.
  useEffect(() => {
    writeSidebarPrefs(browserStorage(), prefs);
  }, [prefs]);
  useEffect(() => {
    writeDrawerPrefs(browserStorage(), drawerPrefs);
  }, [drawerPrefs]);

  useEffect(() => {
    writeDrawerTabPrefs(browserStorage(), tabPrefs);
  }, [tabPrefs]);

  // Board shortcuts come from the registry. Keys pressed inside a terminal belong to the
  // shell, so none of them fire there; the palette key still works from a text field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('.xterm')) return;
      const id = findShortcutId(event, { typing: isTypingTarget(target), groups: ['board'] });
      if (id === 'board.palette') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (id === 'board.sidebar') {
        event.preventDefault();
        setPrefs((current) => ({ ...current, collapsed: !current.collapsed }));
      } else if (id === 'board.help') {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (id === 'board.files') {
        event.preventDefault();
        setOpened((current) => (current?.kind === 'files' ? null : { kind: 'files' }));
      } else if (id === 'board.ledger' && ledgerAvailable) {
        event.preventDefault();
        toggleLedgerRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ledgerAvailable]);

  function toggleSidebar(): void {
    if (mode === 'phone') {
      setSheetOpen((open) => !open);
      return;
    }
    setPrefs((current) => ({ ...current, collapsed: !current.collapsed }));
  }

  function toggleProject(key: string): void {
    setPrefs((current) => ({
      ...current,
      collapsedProjects: toggleProjectKey(current.collapsedProjects, key),
    }));
  }

  // On a phone the sidebar is a sheet over the lanes; picking an agent closes it so its drawer shows.
  function dismissSheet(): void {
    if (mode !== 'phone') return;
    setSheetOpen(false);
  }

  // On a phone the open sheet closes on Escape, as a modal does, unless the roles dialog is open.
  useEffect(() => {
    if (mode !== 'phone' || !sheetOpen || rolesOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (matchShortcut('board.escape', event)) setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, sheetOpen, rolesOpen]);

  function selectSession(sessionId: string): void {
    setOpened(null);
    dismissSheet();
    client.select(selectionForSession(state, sessionId));
  }

  function selectTask(taskId: string): void {
    setOpened(null);
    dismissSheet();
    client.select(selectionForTask(state, taskId));
  }

  function openProjectChanges(checkoutPath: string, tab: 'diff' | 'merge' | 'compare' = 'diff', branchA = ''): void {
    setSelectedCheckoutId(checkoutPath);
    setChangesTab(tab);
    setCompareBranchA(branchA);
    if (tab !== 'compare') projectStore.requestDiff({ checkout: checkoutPath, scope: 'uncommitted', sha: '' });
    selectPage('changes');
  }

  function openProjectSettings(nodeId: string | null): void {
    setProjectSettingsNode(nodeId);
    projectStore.requestSettings(nodeId ?? undefined);
  }

  /**
   * A board session opens in the drawer, a session in a herdr pane (a herdr row, or a
   * ledger session herdr reports) in that pane's terminal. A session with neither (a Claude or
   * agy run in a terminal of its own) has no pane to open or type into: the board says so.
   */
  function openProjectSession(session: ProjectTreeNode, where: { readonly folderPath?: string }): void {
    const id = session.sessionId;
    if (id === undefined) return;
    setSessionNotice(null);
    const cloud = parseCloudNodeId(id);
    if (cloud !== null) {
      openCloudNode(session, cloud.machine, cloud.session);
      return;
    }
    // The tree names omp sessions by their native id; the server adds the board session behind one.
    const boardKey = session.boardSessionId ?? (state.sessions[id] !== undefined ? id : null);
    if (boardKey !== null && state.sessions[boardKey] !== undefined) selectSession(boardKey);
    else if (boardKey !== null && where.folderPath !== undefined) selectWorkspaceSession(where.folderPath, boardKey);
    else if (isEndedNode(session)) setStoppedNode(session);
    else if (session.herdrPaneId !== undefined) openHerdr(revealPane(session.herdrPaneId, where));
    else if (session.agentKind === 'herdr' && session.state === 'sleeping') openSleeping(revealPane(id, where));
    else if (session.agentKind === 'herdr') openHerdr(revealPane(id, where));
    else if (session.engine === 'claude' || session.engine === 'agy') setSessionNotice(`Phiên ${session.name} chạy ngoài herdr (cửa sổ terminal riêng): board không mở hay gõ vào được. Gõ ở cửa sổ đang chạy nó, hoặc bấm "+ Phiên mới" để mở phiên trong herdr.`);
    else setSessionNotice(`Phiên ${session.name} không có khung nào để mở trên board lúc này.`);
  }

  /** A cloud row: a live one opens its tmux terminal in the drawer; an asleep one has none, so its branch's changes open instead. */
  function openCloudNode(node: ProjectTreeNode, machine: string, session: string): void {
    // The terminal cannot open before the machine has created the session: opening it now would wait forever.
    if (pendingCloud?.machine === machine && pendingCloud.session === session) {
      setSessionNotice(`Phiên cloud ${node.name} đang khởi động trên ${machine}, đợi máy tạo xong rồi bấm lại.`);
      return;
    }
    if (node.state !== 'sleeping') {
      setOpened({ kind: 'cloud', machine, session });
      dismissSheet();
      return;
    }
    // Its changes are read from the machine: a paused one cannot answer, so say so instead of opening an empty page.
    if (fleetMachines?.some((entry) => entry.agentId === machine && entry.state !== 'online') === true) {
      setPausedMachine(machine);
      setSessionNotice(pausedMachineNotice(machine));
      return;
    }
    openCloudChanges(node, machine);
  }

  function openCloudChanges(node: ProjectTreeNode, machine: string): void {
    if (node.path === undefined) {
      setSessionNotice(`Phiên cloud ${node.name} đã ngủ và không còn nhánh nào để xem thay đổi.`);
      return;
    }
    fleetStore.requestDiff(machine, node.path);
    selectPage('cloud');
  }

  /**
   * The folder view hides the panes of every other folder, even one the user just opened, so a
   * click on another folder's session in the tree showed nothing. Point the board at that folder,
   * as an omp session of another folder does; the pane shows once the switch lands.
   */
  function revealPane(paneId: string, where: { readonly folderPath?: string }): string {
    if (where.folderPath !== undefined && herdrPaneHidden(state, paneId)) client.openWorkspace(where.folderPath);
    return paneId;
  }

  /** Menu actions that leave the menu: pages and dialogs. Tree edits run in the menu itself. */
  function runProjectNodeAction(node: ProjectTreeNode, action: ProjectNodeAction): void {
    const cloudRef = parseCloudNodeId(node.id);
    if (cloudRef !== null && action === 'changes') {
      openCloudChanges(node, cloudRef.machine);
      return;
    }
    if (action === 'changes' || action === 'merge' || action === 'compare') {
      const checkout = checkoutPathFor(projects.nodes, node);
      if (checkout !== null) openProjectChanges(checkout, action === 'merge' ? 'merge' : action === 'compare' ? 'compare' : 'diff', node.branch ?? '');
      return;
    }
    if (action === 'settings') {
      openProjectSettings(node.id);
      return;
    }
    if (cloudRef !== null && action === 'cloudClean') {
      fleetStore.cleanTask(cloudRef.machine, cloudRef.session, true);
      return;
    }
    if (action === 'closeHerdr') {
      const paneId = node.herdrPaneId ?? (node.agentKind === 'herdr' ? node.sessionId : undefined);
      if (paneId !== undefined) client.herdrClose(paneId);
      return;
    }
    if (action === 'addFolderBrowse') {
      void addFolderFromPicker(node);
      return;
    }
    if (action === 'wake') {
      const paneId = node.herdrPaneId ?? node.sessionId;
      if (paneId !== undefined) client.herdrWake(paneId);
      return;
    }
    if (action === 'openSession') {
      const folderPath = ancestorOf(projects.nodes, node, 'folder')?.path;
      openProjectSession(node, folderPath === undefined ? {} : { folderPath });
      return;
    }
    const cloudEngine = cloudEngineForAction(action);
    if (cloudEngine !== undefined) {
      // The request box opens under the right-clicked node in the sidebar, with no change of page.
      setCloudRequest({ engine: cloudEngine, token: Date.now(), nodeId: node.id });
      return;
    }
    if (
      action === 'newSession' ||
      action === 'newSessionOmp' ||
      action === 'newSessionClaude' ||
      action === 'newSessionAgy' ||
      action === 'newSessionCodex' ||
      action === 'newSessionPi' ||
      action === 'newSessionThinkRail'
    ) {
      const engine = engineForAction(action);
      setNewSessionNode({ nodeId: node.id, ...(engine === undefined ? {} : { engine }) });
    }
  }

  const globalOmpRoleModels = COMPANY_ROLES.flatMap((role) => {
    const profile = roleProfile(state, role);
    return profile === null
      ? []
      : [{ role, model: profile.requestedModel, ...(profile.thinking ? { thinking: profile.thinking } : {}) }];
  });

  function openHerdr(paneId: string, tab: HerdrDrawerTab = 'screen', starting = false): void {
    setOpened({ kind: 'herdr', paneId, ...(starting ? { starting: true } : {}) });
    setHerdrTab(tab);
    client.select({ herdrPaneId: paneId });
    dismissSheet();
  }

  function openSleeping(paneId: string): void {
    setOpened({ kind: 'sleeping', paneId });
    // The composer aims at it: a line sent there wakes the session with that line as its prompt.
    client.select({ herdrPaneId: paneId });
    dismissSheet();
  }

  /**
   * A work item card opens onto the agent that holds it, as a session row does: its live terminal
   * and log are what the user wants to see, whatever the item's status. The composer below talks
   * to that agent. An item no live agent holds (queued, run by Claude Code, or its herdr tab since
   * closed) opens the item's panel, which shows its result and history.
   */
  function openWorkItemCard(ref: { id: string; workspacePath: string }): void {
    const item = workItemsOf(state, ref.workspacePath).items.find((entry) => entry.id === ref.id);
    const target = workItemCardTarget(state, item);
    switch (target.kind) {
      case 'sleeping':
        openSleeping(target.paneId);
        return;
      case 'herdr':
        openHerdr(target.paneId);
        return;
      case 'session':
        openSessionTab(target.sessionId, 'terminal');
        return;
      case 'workspaceSession':
        selectWorkspaceSession(ref.workspacePath, target.sessionId);
        return;
      case 'panel':
        setOpened({ kind: 'workItem', ...ref });
    }
  }

  function openSessionTab(sessionId: string, tab: CompanyDrawerTab): void {
    setOpened(null);
    setTabPrefs({ session: tab });
    client.select({ ...selectionForSession(state, sessionId), tab });
  }

  /** Switch the board to another folder; the session is selected once that folder's snapshot holds it. */
  function selectWorkspaceSession(path: string, sessionId: string): void {
    setOpened(null);
    dismissSheet();
    client.openWorkspaceSession(path, sessionId);
  }

  function openContract(contractId: string | null): void {
    setOpened({ kind: 'contract', contractId });
  }

  function closeDrawer(): void {
    setOpened(null);
    client.select({ sessionId: null, taskId: null, tab: null });
  }
  function selectSquad(ref: { runId: string; workspacePath: string }): void {
    setOpened({ kind: 'squad', ...ref });
    dismissSheet();
  }

  function closeRemovedSquad(ref: { runId: string; workspacePath: string }): void {
    if (
      opened?.kind === 'squad' &&
      opened.runId === ref.runId &&
      opened.workspacePath === ref.workspacePath
    ) {
      closeDrawer();
    }
  }

  function toggleFiles(): void {
    setOpened((current) => (current?.kind === 'files' ? null : { kind: 'files' }));
  }

  function toggleDrawerMaximized(): void {
    setDrawerPrefs((current) => ({ ...current, maximized: !current.maximized }));
  }

  /** Runs the row the palette chose: select a session, task or agent, switch folder, or act. */
  function runPaletteItem(item: PaletteItem): void {
    setPaletteOpen(false);
    const target = item.target;
    switch (target.kind) {
      case 'action':
        runPaletteAction(target.action);
        return;
      case 'session':
        selectSession(target.sessionId);
        return;
      case 'task':
        selectTask(target.taskId);
        return;
      case 'herdr':
        openHerdr(target.paneId);
        return;
      case 'sleeping':
        openSleeping(target.paneId);
        return;
      case 'folder':
        if (target.path !== state.settings?.workspacePath) client.openWorkspace(target.path);
        return;
      case 'file':
        // The Tệp drawer opens; the chosen path is not yet passed to its browser.
        setOpened({ kind: 'files' });
        return;
    }
  }

  /** "Tạo project": a folder chosen in Windows' dialog becomes a new Project, named after it and holding it. */
  async function createProjectFromPickedFolder(): Promise<void> {
    setSessionNotice(null);
    const picked = await pickFolder(client);
    if (picked === null) return;
    if ('notice' in picked) {
      setSessionNotice(picked.notice);
      return;
    }
    const name = folderBasename(picked.path) || picked.path;
    const requestId = projectStore.createNode({ kind: 'project', name, path: picked.path });
    const outcome = await waitForProjectCreate(projectStore, requestId);
    if ('superseded' in outcome) return;
    // The new Project lands at the end of the list, out of sight: show it on its own.
    if ('refusal' in outcome) {
      const holder = projectHoldingFolder(projects.nodes, picked.path);
      if (holder !== undefined) setSelectedProjectId(holder);
      setSessionNotice(`Không tạo được project: ${outcome.refusal}`);
      return;
    }
    if (outcome.nodeId !== undefined) setSelectedProjectId(outcome.nodeId);
    setSessionNotice(`Đã tạo project ${name}. Bấm "Tất cả dự án" để xem lại mọi project.`);
  }

  /**
   * "Duyệt…" in a Project's "Thêm thư mục": the folder chosen in Windows' dialog joins that Project
   * (or group) at once. The menu closed when the dialog opened, so the outcome is told here.
   */
  async function addFolderFromPicker(node: ProjectTreeNode): Promise<void> {
    const project = node.kind === 'project' ? node : ancestorOf(projects.nodes, node, 'project');
    if (project === undefined) return;
    setSessionNotice(null);
    const picked = await pickFolder(client);
    if (picked === null) return;
    if ('notice' in picked) {
      setSessionNotice(picked.notice);
      return;
    }
    const name = folderBasename(picked.path) || picked.path;
    const requestId = projectStore.createNode({ kind: 'folder', parentId: node.kind === 'group' ? node.id : project.id, name, path: picked.path });
    const outcome = await waitForProjectCreate(projectStore, requestId);
    if ('superseded' in outcome) return;
    if ('refusal' in outcome) {
      const holder = projectHoldingFolder(projects.nodes, picked.path);
      if (holder !== undefined) setSelectedProjectId(holder);
      setSessionNotice(`Không thêm được thư mục ${name}: ${outcome.refusal}`);
      return;
    }
    setSelectedProjectId(project.id);
    setSessionNotice(`Đã thêm thư mục ${name} vào project ${project.name}.`);
  }

  /** "Mở thư mục…" in the palette: choose a folder in Windows' dialog and show it on the board. */
  async function openFolderFromPalette(): Promise<void> {
    setSessionNotice(null);
    const opened = await openPickedFolder(client);
    if (typeof opened === 'object') setSessionNotice(opened.notice);
  }

  function runPaletteAction(action: PaletteActionId): void {
    switch (action) {
      case 'new-chat':
        startNewChat(client);
        return;
      case 'open-agents':
        if (mode === 'phone') setSheetOpen(true);
        else setPrefs((current) => ({ ...current, collapsed: false }));
        return;
      case 'open-git-tree':
        if (ledgerAvailable) selectPage('ledger');
        return;
      case 'open-files':
        setOpened({ kind: 'files' });
        return;
      case 'open-folder':
        void openFolderFromPalette();
        return;
      case 'open-roles':
        setRolesOpen(true);
        return;
      case 'open-usage':
        selectPage('usage');
        return;
      case 'show-shortcuts':
        setShortcutsOpen(true);
        return;
    }
  }

  const boardAreaRef = useRef<HTMLDivElement>(null);

  const navItems: { page: ShellPage; label: string; icon: IconName; group: string }[] = [
    { page: 'board', label: 'Bảng việc', icon: 'list', group: 'Không gian làm việc' },
    ...(ledgerAvailable
      ? [
          { page: 'ledger' as const, label: 'Cây git', icon: 'git-branch' as const, group: 'Không gian làm việc' },
          { page: 'changes' as const, label: 'Thay đổi', icon: 'file-text' as const, group: 'Không gian làm việc' },
          { page: 'openspec' as const, label: 'OpenSpec', icon: 'file-text' as const, group: 'Không gian làm việc' },
        ]
      : []),
    ...(sessionsAvailable
      ? [{ page: 'sessions' as const, label: 'Phiên agent', icon: 'terminal' as const, group: 'Không gian làm việc' }]
      : []),
    ...(fleetAvailable
      ? [
          {
            page: 'cloud' as const,
            label: 'Cloud',
            icon: 'terminal' as const,
            group: 'Không gian làm việc',
          },
          {
            page: 'guard' as const,
            label: 'Rủi ro mất code',
            icon: 'alert-triangle' as const,
            group: 'Không gian làm việc',
          },
        ]
      : []),
    { page: 'usage', label: 'Sử dụng', icon: 'bar-chart', group: 'Không gian làm việc' },
    ...(ledgerAvailable
      ? [
          { page: 'storage' as const, label: 'Lưu trữ', icon: 'archive' as const, group: 'Thư viện' },
          { page: 'skills' as const, label: 'Kho skill', icon: 'list' as const, group: 'Thư viện' },
          { page: 'mcp' as const, label: 'MCP', icon: 'terminal' as const, group: 'Thư viện' },
          { page: 'accounts' as const, label: 'Tài khoản', icon: 'users' as const, group: 'Cài đặt' },
        ]
      : []),
  ];

  /** The phone menu: one page per row, under its group's heading. */
  function renderNavItems() {
    let previousGroup = '';
    return navItems.map((item) => {
      const showGroup = item.group !== previousGroup;
      previousGroup = item.group;
      return (
        <div key={item.page} className="flex flex-col">
          {showGroup && (
            <p className="px-3 pb-1 pt-4 text-2xs font-medium uppercase tracking-wider text-text-muted">
              {item.group}
            </p>
          )}
          <button
            type="button"
            aria-current={activePage === item.page ? 'page' : undefined}
            onClick={() => selectPage(item.page)}
            className={`flex min-h-10 items-center gap-3 rounded-(--company-radius-sm) px-3 text-left text-sm transition-colors duration-150 hover:bg-hover motion-reduce:transition-none ${activePage === item.page ? 'bg-selected text-text' : 'text-text-secondary'}`}
          >
            <Icon name={item.icon} className="shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.page === 'guard' && redGuardCount > 0 && (
              <span
                aria-label={`${redGuardCount} rủi ro đỏ`}
                className="ml-auto min-w-5 rounded-full bg-danger/12 px-1.5 text-center text-2xs text-danger"
              >
                {redGuardCount}
              </span>
            )}
          </button>
        </div>
      );
    });
  }

  /** The board's controls: inside the page header on a desktop, in a row of their own on a phone. */
  function boardTopBar(inHeader: boolean) {
    return (
      <BoardTopBar
        state={state}
        client={client}
        sidebarCollapsed={sidebarCollapsed}
        mode={mode}
        onToggleSidebar={toggleSidebar}
        filesOpen={opened?.kind === 'files'}
        onToggleFiles={toggleFiles}
        ledgerAvailable={ledgerAvailable}
        ledgerOpen={ledgerShown}
        onToggleLedger={toggleActiveLedgerPage}
        isMac={IS_MAC}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenRoles={() => setRolesOpen(true)}
        onOpenUsage={() => selectPage('usage')}
        inHeader={inHeader}
      />
    );
  }

  return (
    <div
      className="company-ui company-shell-root flex h-full w-full flex-col overflow-hidden bg-bg"
      data-testid="company-workspace"
      style={{ '--company-page-transition': `${COMPANY_PAGE_TRANSITION_MS}ms` } as CSSProperties}
    >
      <header className="company-nav-mobile items-center gap-3 border-b border-hairline bg-panel px-3 py-2">
        <button
          type="button"
          aria-label={mobileNavOpen ? 'Đóng điều hướng' : 'Mở điều hướng'}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((open) => !open)}
          className="company-icon-btn touch-target shrink-0"
        >
          <Icon name="menu" />
        </button>
        <span className="font-medium">Agent Board</span>
        {redGuardCount > 0 && (
          <span
            aria-label={`${redGuardCount} rủi ro đỏ`}
            className="rounded-full bg-danger/12 px-1.5 text-2xs text-danger"
          >
            {redGuardCount}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-sm text-text-secondary">
          {navItems.find((item) => item.page === activePage)?.label ?? 'Bảng việc'}
        </span>
      </header>
      <header
        className="company-nav-desktop h-10 shrink-0 items-center gap-3 border-b border-hairline bg-panel px-3"
        aria-label="Điều hướng"
      >
        <span className="shrink-0 font-semibold tracking-tight">Agent Board</span>
        {redGuardCount > 0 && (
          <span
            aria-label={`${redGuardCount} rủi ro đỏ`}
            className="rounded-full bg-danger/12 px-1.5 text-2xs text-danger"
          >
            {redGuardCount}
          </span>
        )}
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Trang">
          {navItems.map((item) => (
            <button
              key={item.page}
              type="button"
              aria-current={activePage === item.page ? 'page' : undefined}
              onClick={() => selectPage(item.page)}
              className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-(--company-radius-sm) px-2.5 text-xs transition-colors duration-150 hover:bg-hover motion-reduce:transition-none ${activePage === item.page ? 'bg-selected text-text' : 'text-text-secondary'}`}
            >
              <Icon name={item.icon} className="shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
              {item.page === 'guard' && redGuardCount > 0 && (
                <span
                  aria-label={`${redGuardCount} rủi ro đỏ`}
                  className="rounded-full bg-danger/12 px-1.5 text-2xs text-danger"
                >
                  {redGuardCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        {(activePage === 'board' || activePage === 'ledger') && boardTopBar(true)}
      </header>
      {mobileViewport && mobileNavOpen && (
        <>
          <button
            type="button"
            aria-label="Đóng điều hướng"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40"
          />
          <nav
            className="fixed inset-x-0 top-12 z-50 max-h-[calc(100dvh-3rem)] overflow-y-auto border-b border-hairline bg-panel p-3 shadow-lg"
            aria-label="Trang"
          >
            {renderNavItems()}
          </nav>
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {activePage === 'board' || activePage === 'ledger' ? (
      <>
      <div key={activePage} className="company-shell-page flex min-h-0 flex-1 flex-col">
      {mobileViewport && boardTopBar(false)}
      {state.needsSnapshot && (
        <p className="bg-warning/12 px-3 py-1.5 text-2xs text-warning">
          {snapshotNoticeText(state)}
        </p>
      )}
      {state.workspaceSelectionNotice !== null && (
        <p
          role="status"
          data-testid="workspace-selection-notice"
          className="bg-warning/12 px-3 py-1.5 text-2xs text-warning"
        >
          {state.workspaceSelectionNotice}
        </p>
      )}
      {fleet.action !== null && fleet.action.kind !== 'terminal' && activePage !== 'cloud' && (
        <div data-testid="fleet-busy" className="bg-warning/12 px-3 py-1.5">
          <BusyNote
            text={`${FLEET_ACTION_LABEL[fleet.action.kind]} trên ${fleet.action.machine} (${fleet.action.session})…`}
            since={fleet.action.startedAt}
            onCancel={fleetStore.cancelAction}
          />
        </div>
      )}
      {projectBusy !== null && (
        <div data-testid="project-busy" className="bg-warning/12 px-3 py-1.5">
          <BusyNote text={projectBusy} />
        </div>
      )}
      {sessionNotice !== null && (
        <p role="status" data-testid="session-open-notice" className="flex items-center gap-2 bg-warning/12 px-3 py-1.5 text-2xs text-warning">
          <span className="min-w-0 flex-1">{sessionNotice}</span>
          {pausedMachine !== null && sessionNotice === pausedMachineNotice(pausedMachine) && (
            <button
              type="button"
              className="company-btn company-btn-sm company-btn-primary"
              disabled={fleet.action !== null}
              onClick={() => fleetStore.wakeMachine(pausedMachine)}
            >
              {fleet.action?.kind === 'wake' ? 'Đang bật máy…' : `Bật máy ${pausedMachine}`}
            </button>
          )}
          {pushableClean !== null && sessionNotice?.startsWith('Không xoá được phiên cloud') === true && (
            <button
              type="button"
              className="company-btn company-btn-sm company-btn-primary"
              disabled={fleet.action !== null}
              title="Đẩy nhánh cloud/… của phiên lên GitHub (không phải main), rồi xóa phiên trên máy. Commit không mất."
              onClick={() => {
                fleetStore.cleanTask(pushableClean.machine, pushableClean.session, true);
                setPushableClean(null);
                setSessionNotice(null);
              }}
            >
              Đẩy nhánh rồi xóa
            </button>
          )}
          <button type="button" aria-label="Đóng thông báo" onClick={() => setSessionNotice(null)}>×</button>
        </p>
      )}
      <AttentionBar
        contract={pendingContract(state)}
        questions={pendingQuestions}
        identityOf={(id) => folderIdentityOf(state, id)}
        onOpenContract={() => openContract(null)}
        onOpenQuestion={(questionId) => setOpened({ kind: 'question', questionId })}
      />
      <TerminalPreviewProvider
        client={client}
        state={state}
        drawerSubject={subject}
        boardAreaRef={boardAreaRef}
      >
        <div ref={boardAreaRef} className="relative flex min-h-0 flex-1 overflow-hidden">
          {(sidebar === 'overlay' || sidebar === 'sheet') && (
            <button
              type="button"
              aria-label={sidebar === 'sheet' ? 'Đóng đàn agent' : 'Thu gọn đàn agent'}
              onClick={sidebar === 'sheet' ? dismissSheet : toggleSidebar}
              className={`${sidebar === 'sheet' ? 'fixed z-30' : 'absolute z-20'} inset-0 cursor-default bg-black/40`}
            />
          )}
          {sidebar === 'rail' && (
            <AgentRail
              state={state}
              selectedSessionId={selectedSessionId}
              selectedPaneId={selectedPaneId}
              collapsedProjects={collapsedProjects}
              onExpand={toggleSidebar}
              onSelectSession={selectSession}
              onSelectWorkspaceSession={selectWorkspaceSession}
              onOpenHerdr={openHerdr}
              onOpenSleeping={openSleeping}
              onToggleProject={toggleProject}
              onMenu={openMenu}
            />
          )}
          {(sidebar === 'docked' || sidebar === 'overlay' || sidebar === 'sheet') && (
            <AgentSidebar
              width={prefs.width}
              presentation={sidebar}
              onWidthChange={(width) =>
                setPrefs((current) => ({ ...current, width: clampSidebarWidth(width) }))
              }
              onCollapse={toggleSidebar}
              projectTree={{
                nodes: treeNodes,
                selectedProjectId,
                onSelectProject: (projectId) => {
                  setSelectedProjectId(projectId);
                  if (projectId === null) {
                    client.setViewMode('all');
                    return;
                  }
                  const node = projects.nodes.find((candidate) => candidate.id === projectId);
                  if (node?.path !== undefined) {
                    client.setFocusFolder(node.path);
                    client.setViewMode('folder');
                  }
                },
                onCreateProject: () => void createProjectFromPickedFolder(),
                onOpenChanges: openProjectChanges,
                onOpenSettings: openProjectSettings,
                onNewSession: (nodeId, engine) => setNewSessionNode({ nodeId, ...(engine === undefined ? {} : { engine }) }),
                onOpenSession: openProjectSession,
                onOpenStopped: (node) => {
                  const cloud = parseCloudNodeId(node.id);
                  if (cloud === null) setStoppedNode(node);
                  else openCloudNode(node, cloud.machine, cloud.session);
                },
                onMenu: openMenu,
                store: projectStore,
                selection: { sessionId: opened?.kind === 'cloud' ? cloudNodeId(opened.machine, opened.session) : selectedSessionId, paneId: selectedPaneId },
                contextOf: (node) => contextOfNode(node, state.sessions),
                ...(fleetAvailable
                  ? {
                      cloud: {
                        machines: fleet.snapshot?.machines ?? [],
                        onCreate: ({ machine, prompt, engine, nodeId }) => {
                          const slug = slugFromPrompt(prompt, randomSuffix());
                          if (nodeId !== undefined) {
                            // The tmux session is named after the slug, so its row can be placed before the machine reports it.
                            const next = { ...cloudFolders, [cloudFolderKey(machine, slug)]: nodeId };
                            setCloudFolders(next);
                            writeCloudFolders(next);
                          }
                          fleetStore.createTask({ machine, repo: 'all', slug, prompt, engine });
                        },
                        nodes: projects.nodes,
                        // The drawer's own panel reports a failed terminal, so the section keeps its error for creation.
                        error: opened?.kind === 'cloud' ? null : fleet.actionError,
                        busy: fleet.action !== null,
                        request: cloudRequest,
                      },
                    }
                  : {}),
              }}
              onOpenRoles={() => setRolesOpen(true)}
              onDismiss={dismissSheet}
            />
          )}
          {/* The composer sits under the board column only, so the agent list and the drawer run the full height. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {ledgerShown ? (
            <LedgerView
              boardSessions={ledgerBoardSessions}
              focus={ledgerFocus}
              folders={ledgerFolders}
              onOpenBoardSession={selectSession}
              panes={ledgerPanes}
              onOpenHerdr={openHerdr}
              onOpenSleeping={openSleeping}
              onClose={() => selectPage('board')}
              onCompare={(repo, branch) => {
                // The ledger writes `V:/a/b`, the Project tree may write `V:\a\b`: compare them separator- and case-blind.
                const key = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
                const repository = projects.nodes.find((node) => node.kind === 'repository' && node.path !== undefined && key(node.path) === key(repo));
                const branchCheckout = projects.nodes.find((node) => node.kind === 'checkout' && node.parentId === repository?.id && node.branch === branch);
                if (branchCheckout?.path) openProjectChanges(branchCheckout.path, 'compare', branch);
              }}
            />
          ) : (
            <CompanyBoard
              lanes={lanes}
              flow={boardFlow(lanes, squadFolder?.settings?.maxParallel ?? state.settings?.maxWorkers ?? null)}
              squadFolder={squadFolder}
              planning={planningPrompts(state)}
              onSelectSession={selectSession}
              onSelectTask={selectTask}
              onOpenHerdr={openHerdr}
              selectedPaneId={selectedPaneId}
              selectedSessionId={selectedSessionId}
              selectedWorkItem={selectedWorkItem}
              onOpenWorkItem={openWorkItemCard}
              selectedSquad={selectedSquad}
              onOpenSquad={(ref) => setOpened({ kind: 'squad', ...ref })}
              client={client}
              onMenu={openMenu}
              selectedCloudId={opened?.kind === 'cloud' ? cloudNodeId(opened.machine, opened.session) : null}
              onOpenCloud={(machine, session) => {
                const node = treeNodes.find((entry) => entry.id === cloudNodeId(machine, session));
                if (node !== undefined) openCloudNode(node, machine, session);
              }}
              changesFor={(card) => {
                const { subject } = card;
                if (subject.kind === 'cloud') return null;
                // The session in the pane knows where it edits; the pane's own repo is the fallback.
                const checkout = (subject.kind === 'herdr' ? paneCheckout.get(subject.paneId) : undefined) ?? card.checkout;
                // The counts are the session's own: sessions sharing a checkout must not all show its total.
                const session = projects.nodes.find((node) =>
                  node.kind === 'session' && (subject.kind === 'herdr' ? node.herdrPaneId === subject.paneId : node.boardSessionId === subject.sessionId));
                const changes = sessionChanges(session);
                return checkout === null || changes === null ? null : { checkout, ...changes };
              }}
              onOpenChanges={(checkout) => openProjectChanges(checkout)}
              identityOf={(id) => folderIdentityOf(state, id)}
            />
          )}
          {!composerHidden && <PromptComposer client={client} projectFolders={ledgerFolders} {...(cloudTarget === undefined ? {} : { cloudTarget })} />}
          </div>
          <DetailDrawer
            client={client}
            state={state}
            subject={subject}
            lanes={lanes}
            artifactId={artifactId}
            onOpen={setOpened}
            onOpenSessionTab={openSessionTab}
            onOpenArtifact={(id) => {
              setArtifactId(id);
              setOpened({ kind: 'files' });
            }}
            onClearArtifact={() => setArtifactId(null)}
            onClose={closeDrawer}
            herdrTab={herdrTab}
            onHerdrTab={setHerdrTab}
            sessionTab={tabPrefs.session}
            onSessionTab={(tab) => setTabPrefs({ session: tab })}
            prefs={drawerPrefs}
            onPrefsChange={setDrawerPrefs}
            sidebarWidth={sidebarFootprint}
            onMenu={openMenu}
            workItemAction={
              opened?.kind === 'workItem' &&
              workItemAction?.ref.id === opened.id &&
              workItemAction.ref.workspacePath === opened.workspacePath
                ? { action: workItemAction.action, token: workItemAction.token }
                : null
            }
            onWorkItemActionHandled={(token) =>
              setWorkItemAction((current) => (current?.token === token ? null : current))
            }
          />
        </div>
      </TerminalPreviewProvider>
      </div>
      </>
      ) : activePage === 'cloud' ? (
        <FleetView request={cloudRequest} />
      ) : activePage === 'guard' ? (
        <GuardView />
      ) : activePage === 'sessions' ? (
        <AgentSessionsPage
          localSessions={ledger.view?.sessions ?? []}
          machines={fleet.snapshot?.machines ?? []}
          onRefreshFleet={refreshFleet}
          fleetAvailable={fleetAvailable}
          localAvailable={ledgerAvailable}
        />
      ) : activePage === 'openspec' ? (
        <OpenSpecPage
          changes={ledger.openSpecChanges}
          loading={ledger.latest.openSpec !== null}
          error={ledger.openSpecError}
          file={ledger.openSpecFile}
          onRefresh={() => ledgerStore.requestOpenSpec()}
          onOpenFile={(change, file) => ledgerStore.requestOpenSpecFile(change.worktree, change.id, file)}
          onCloseFile={() => ledgerStore.clearOpenSpecFile()}
        />
      ) : activePage === 'changes' ? (
        <ChangesPage store={projectStore} checkoutId={selectedCheckoutId} initialTab={changesTab} initialBranchA={compareBranchA} onClose={() => selectPage('board')} />
      ) : activePage === 'usage' ? (
        <div key="usage-page" className="company-shell-page flex min-h-0 flex-1 flex-col">
          <UsagePage client={client} />
        </div>
      ) : activePage === 'storage' ? (
        <div key="storage-page" className="company-shell-page flex min-h-0 flex-1 flex-col">
          <StoragePage />
        </div>
      ) : activePage === 'skills' ? (
        <div key="skills-page" className="company-shell-page flex min-h-0 flex-1 flex-col">
          <SkillsPage />
        </div>
      ) : activePage === 'mcp' ? (
        <div key="mcp-page" className="company-shell-page flex min-h-0 flex-1 flex-col">
          <McpPage />
        </div>
      ) : (
        <div key="accounts-page" className="company-shell-page flex min-h-0 flex-1 flex-col">
          <AccountsPage />
        </div>
      )}
      {projectSettingsNode !== null && (
        <LayeredSettingsDialog
          store={projectStore}
          nodeId={projectSettingsNode}
          globalOmpRoleModels={globalOmpRoleModels}
          onClose={() => setProjectSettingsNode(null)}
        />
      )}
      {newSessionNode !== null && (
        <NewSessionDialog
          store={projectStore}
          nodeId={newSessionNode.nodeId}
          {...(newSessionNode.engine === undefined ? {} : { initialEngine: newSessionNode.engine })}
          onClose={() => setNewSessionNode(null)}
          onStarted={({ sessionId, engine, folderPath }) => {
            setNewSessionNode(null);
            // Claude and agy open as interactive agents in a herdr tab: show that pane's screen.
            if (engine !== 'omp') {
              openHerdr(sessionId, 'screen', true);
              return;
            }
            // An omp chat lives in its folder's board, so the board switches there to show it.
            if (folderPath !== undefined) selectWorkspaceSession(folderPath, sessionId);
          }}
        />
      )}
      {stoppedNode !== null && (
        <StoppedSessionDialog
          // The tree refreshes while it is open: show the node's newest facts.
          node={projects.nodes.find((candidate) => candidate.id === stoppedNode.id) ?? stoppedNode}
          client={client}
          store={projectStore}
          onClose={() => setStoppedNode(null)}
          onWoken={(target) => {
            setStoppedNode(null);
            if ('paneId' in target) openHerdr(target.paneId, 'screen', true);
            else selectWorkspaceSession(target.folder, target.boardSessionId);
          }}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onRun={runPaletteItem}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {rolesOpen && (
        <RolesDialog client={client} state={state} onClose={() => setRolesOpen(false)} />
      )}
      {shortcutsOpen && <ShortcutsSheet isMac={IS_MAC} onClose={() => setShortcutsOpen(false)} />}
      {menu !== null && (
        <AgentContextMenu
          key={menu.token}
          client={client}
          state={state}
          request={menu}
          onClose={closeMenu}
          onSessionTab={openSessionTab}
          onHerdrTab={openHerdr}
          onSelectTask={selectTask}
          onSelectSession={selectSession}
          onOpenContract={openContract}
          onToggleMaximize={toggleDrawerMaximized}
          onToggleProject={toggleProject}
          onWorkDialog={setWorkDialog}
          onWorkItemAction={runWorkItemMenuAction}
          onSelectSquad={selectSquad}
          onSquadRemoved={closeRemovedSquad}
          projectStore={projectStore}
          onProjectNodeAction={runProjectNodeAction}
        />
      )}
      <WorkDialogHost
        client={client}
        state={state}
        request={workDialog}
        onClose={() => setWorkDialog(null)}
      />
    </div>
      </div>
  );
}
