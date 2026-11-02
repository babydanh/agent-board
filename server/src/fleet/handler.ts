import type { FleetSnapshotMessage, GitGuardReport, LedgerView, ServerMessage } from '../../../core/src/messages.js';
import { createGitRunner, type GitRunner } from '../ledger/git.js';
import { type ProcessRunner,runProcess } from '../ledger/processRunner.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import { createAskWatch } from './askWatch.js';
import { createFleetBranchAnalysisService, type FleetBranchAnalysisSnapshot } from './branchAnalysis.js';
import {
  createFleetPullRequestLookup,
  type FleetBranchActionName,
  type FleetPullRequestLookup,
  runFleetBranchAction,
} from './branchPullRequests.js';
import { CloudControl, CloudControlError } from './cloudControl.js';
import { createFleetCommandService, type FleetCommandInput, type FleetCommandService } from './commandQueue.js';
import {
  FLEET_COMMAND_BRANCH,
  FLEET_COMMAND_PATH_MAX,
  FLEET_COMMAND_VERBS,
  FLEET_MACHINE_NAME,
  FLEET_REASON_BAD_INPUT,
  FLEET_REASON_COMMAND_FAILED,
  FLEET_REASON_HUB_FALLBACK,
  FLEET_REASON_NO_MACHINE,
  FLEET_REASON_NO_TERMINAL,
  FLEET_REASON_NOT_REPORTED,
  FLEET_REASON_READ_ONLY,
  FLEET_REASON_UNAVAILABLE,
  FLEET_STALE_AFTER_MS,
} from './constants.js';
import { collectFleetBranchPullRequests } from './fleetBranchStatus.js';
import { buildFleetSnapshot, splitLocalReporters } from './fleetSnapshot.js';
import { createFleetHubClient, type FleetHubClient, type FleetHubMachine, type FleetHubResponse, FleetUnavailableError } from './hubClient.js';
import { createPromptWatch } from './promptWatch.js';
import { readExpectedSkillVersion } from './skillVersion.js';

const FALLBACK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
const LEDGER_WAIT_MS = 5000;
const defaultFleetHubClient = createFleetHubClient();
const defaultCommandService = createFleetCommandService();
const defaultPullRequestGit = createGitRunner(runProcess);
const defaultPullRequests = createFleetPullRequestLookup();
const defaultBranchAnalysis = createFleetBranchAnalysisService();
let defaultCloudControl: CloudControl | null = null;
// Which cloud sessions wait on a menu: one watch per cloud control, peeking in the background through it.
const askWatches = new WeakMap<CloudControl, ReturnType<typeof createAskWatch>>();
const promptWatches = new WeakMap<CloudControl, ReturnType<typeof createPromptWatch>>();

export interface FleetCommandContext {
  readonly fleet?: FleetHubClient;
  readonly commands?: FleetCommandService;
  readonly cloud?: CloudControl;
  readonly ledger: { getView: () => Promise<LedgerView> } | null;
  readonly git?: GitRunner;
  readonly pullRequests?: FleetPullRequestLookup;
  readonly ptyManager?: PtySessionManager | null;
  readonly getLocalGuard?: () => GitGuardReport | null;
  readonly processRunner?: ProcessRunner;
  readonly privileged: boolean;
}

export async function getFleetGuardRiskCounts(localGuard?: () => GitGuardReport | null) {
  const reports: (GitGuardReport | null)[] = [localGuard?.() ?? null];
  try {
    const fleet = await defaultFleetHubClient.fetchFleet();
    reports.push(...fleet.machines.map((machine) => machine.guard ?? null));
  } catch {
    // A local board status remains useful when the cloud hub is offline or unconfigured.
  }
  return reports.reduce(
    (counts, report) => {
      for (const risk of report?.risks ?? []) counts[risk.level] += 1;
      return counts;
    },
    { red: 0, yellow: 0 },
  );
}

export async function getFleetBranchCollisionStatus(
  ledger: FleetCommandContext['ledger'],
): Promise<FleetBranchAnalysisSnapshot> {
  const localRead = ledger?.getView().catch(() => null) ?? Promise.resolve(null);
  const localView = Promise.race([localRead, new Promise<null>((resolve) => setTimeout(resolve, LEDGER_WAIT_MS, null))]);
  const fleetRead = defaultFleetHubClient.fetchFleet().catch(() => ({ now: Date.now(), machines: [] }));
  const [view, response] = await Promise.all([localView, fleetRead]);
  defaultBranchAnalysis.schedule(view, response, {
    git: defaultPullRequestGit,
    cloud: cloudOf({ ledger: null, privileged: true }),
  });
  return defaultBranchAnalysis.getSnapshot();
}

const FLEET_TYPES = new Set([
  'fleetRequest',
  'fleetTerminalOpen',
  'fleetTaskCreate',
  'fleetTaskClean',
  'fleetMachineWake',
  'fleetLavishOpen',
  'fleetLavishDelete',
  'fleetSessionRestart',
  'fleetDiffRequest',
  'fleetHistoryRequest',
  'fleetCloudCommentSend',
  'fleetBranchAction',
  'fleetCommandQueue',
  'fleetCommandHistoryRequest',
]);

export function handleFleetMessage(
  msg: Record<string, unknown>,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): boolean {
  if (typeof msg.type !== 'string' || !FLEET_TYPES.has(msg.type)) return false;
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : FALLBACK_REQUEST_ID;

  if (!context.privileged) {
    send(commandResult(requestId, 'forbidden', FLEET_REASON_READ_ONLY));
    return true;
  }

  if (msg.type === 'fleetTerminalOpen') {
    openTerminal(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetTaskCreate') {
    createTask(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetTaskClean') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    const session = typeof msg.session === 'string' ? msg.session : '';
    cloudOf(context)
      .cleanTask(machine, session, msg.pushFirst === true)
      .then(() => send({ type: 'fleetTaskCleaned', requestId, machine, session }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetMachineWake') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    cloudOf(context)
      .wakeMachine(machine)
      .then(() => send({ type: 'fleetCommandResult', requestId, ok: true, code: 'success' }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetLavishDelete') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    const key = typeof msg.key === 'string' ? msg.key : '';
    cloudOf(context)
      .deleteLavish(machine, key)
      .then(() => send({ type: 'fleetCommandResult', requestId, ok: true, code: 'success' }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetSessionRestart') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    const session = typeof msg.session === 'string' ? msg.session : '';
    cloudOf(context)
      .restartSession(machine, session)
      .then(() => send({ type: 'fleetCommandResult', requestId, ok: true, code: 'success' }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetLavishOpen') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    const key = typeof msg.key === 'string' ? msg.key : '';
    cloudOf(context)
      .openLavish(machine, key)
      .then((url) => send({ type: 'fleetLavishOpened', requestId, url }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetDiffRequest') {
    readDiff(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetHistoryRequest') {
    const machine = typeof msg.machine === 'string' ? msg.machine : '';
    const session = typeof msg.session === 'string' ? msg.session : '';
    cloudOf(context)
      .readHistory(machine, session)
      .then((history) => send({ type: 'fleetHistory', requestId, machine, session, text: history.text, truncated: history.truncated }))
      .catch((error: unknown) => send(failure(requestId, error)));
    return true;
  }
  if (msg.type === 'fleetCloudCommentSend') {
    sendCloudComment(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetBranchAction') {
    runLocalBranchAction(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetCommandQueue') {
    queueRemoteCommand(msg, requestId, send, context);
    return true;
  }
  if (msg.type === 'fleetCommandHistoryRequest') {
    (context.commands ?? defaultCommandService)
      .history()
      .then((commands) => send({ type: 'fleetCommandHistory', requestId, commands }))
      .catch((error: unknown) => send(commandFailure(requestId, error)));
    return true;
  }

  const fleet = context.fleet ?? defaultFleetHubClient;
  // A cold ledger view can take over a minute; show the machines without local overlaps rather than wait.
  const ledgerView = context.ledger?.getView().catch(() => null) ?? Promise.resolve(null);
  const localView = Promise.race([ledgerView, new Promise<null>((resolve) => setTimeout(resolve, LEDGER_WAIT_MS, null))]);
  Promise.all([fleet.fetchFleet(), localView])
    .then(async ([hubResponse, view]) => {
      const { cloud: response, reporters } = splitLocalReporters(hubResponse);
      const snapshot = await snapshotWithPullRequests(requestId, response, view, context.getLocalGuard?.() ?? null, context, reporters);
      send(startBranchAnalysis(snapshot, view, response, context, send));
    })
    .catch(async (error: unknown) => {
      const view = await localView;
      const unavailable = error instanceof FleetUnavailableError;
      const localGuard = context.getLocalGuard?.() ?? null;
      // A hub that answered an error (asleep, cooling down) still leaves the running machines readable over InstaBox.
      const rescued = unavailable ? null : await cloudOf(context).readRunningTmux().catch(() => null);
      if (localGuard !== null || rescued !== null) {
        const response = rescued ?? { now: Date.now(), machines: [] };
        const snapshot = await snapshotWithPullRequests(requestId, response, view, localGuard, context);
        send({
          ...startBranchAnalysis(snapshot, view, response, context, send),
          hubError: unavailable ? FLEET_REASON_UNAVAILABLE : rescued !== null ? FLEET_REASON_HUB_FALLBACK : FLEET_REASON_COMMAND_FAILED,
        });
        return;
      }
      send(
        commandResult(
          requestId,
          unavailable ? 'unavailable' : 'failed',
          unavailable ? FLEET_REASON_UNAVAILABLE : FLEET_REASON_COMMAND_FAILED,
        ),
      );
    });
  return true;
}

async function snapshotWithPullRequests(
  requestId: string,
  response: FleetHubResponse,
  localView: LedgerView | null,
  localGuard: GitGuardReport | null,
  context: FleetCommandContext,
  reporters: readonly FleetHubMachine[] = [],
): Promise<FleetSnapshotMessage> {
  const snapshot = promptWatchOf(context).annotate(askWatchOf(context).annotate(buildFleetSnapshot(requestId, response, localView, localGuard, readExpectedSkillVersion(), reporters)));
  try {
    const status = await collectFleetBranchPullRequests(localView, response, {
      git: context.git ?? defaultPullRequestGit,
      pullRequests: context.pullRequests ?? defaultPullRequests,
    });
    const cloudPullRequests = new Map(
      status.cloudBranches.map((branch) => [`${branch.machine}\0${branch.path}\0${branch.branch}`, branch.pullRequest]),
    );
    return {
      ...snapshot,
      localBranches: status.localBranches,
      machines: snapshot.machines.map((machine) => ({
        ...machine,
        repos: machine.repos.map((repo) => {
          const pullRequest = cloudPullRequests.get(`${machine.agentId}\0${repo.path ?? ''}\0${repo.branch}`);
          return pullRequest === undefined ? repo : { ...repo, pullRequest };
        }),
      })),
    };
  } catch {
    return snapshot;
  }
}

function startBranchAnalysis(
  snapshot: FleetSnapshotMessage,
  localView: LedgerView | null,
  response: FleetHubResponse,
  context: FleetCommandContext,
  send: (message: ServerMessage) => void,
): FleetSnapshotMessage {
  const attach = (): FleetSnapshotMessage => {
    const analysis = defaultBranchAnalysis.getSnapshot();
    return {
      ...snapshot,
      branchAnalyses: analysis.analyses,
      branchAnalysisPending: analysis.pending,
    };
  };
  defaultBranchAnalysis.schedule(
    localView,
    response,
    { git: context.git ?? defaultPullRequestGit, cloud: cloudOf(context) },
    () => send(attach()),
  );
  return attach();
}

function askWatchOf(context: FleetCommandContext): ReturnType<typeof createAskWatch> {
  const cloud = cloudOf(context);
  let watch = askWatches.get(cloud);
  if (watch === undefined) {
    watch = createAskWatch((machine, sessions) => cloud.peekAsking(machine, sessions));
    askWatches.set(cloud, watch);
  }
  return watch;
}

function promptWatchOf(context: FleetCommandContext): ReturnType<typeof createPromptWatch> {
  const cloud = cloudOf(context);
  let watch = promptWatches.get(cloud);
  if (watch === undefined) {
    watch = createPromptWatch((machine) => cloud.peekPrompts(machine));
    promptWatches.set(cloud, watch);
  }
  return watch;
}

/** The board's one CloudControl, for server modules outside the fleet commands. */
export function sharedCloudControl(): CloudControl {
  return cloudOf({ ledger: null, privileged: true });
}

function cloudOf(context: FleetCommandContext): CloudControl {
  if (context.cloud) return context.cloud;
  if (defaultCloudControl === null) {
    const created = new CloudControl();
    // Port-forwards are child processes: close them with the board (a forced kill cannot run this).
    process.once('exit', () => created.dispose());
    defaultCloudControl = created;
  }
  return defaultCloudControl;
}

function openTerminal(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const ptyManager = context.ptyManager;
  if (!ptyManager?.isAvailable()) {
    send(commandResult(requestId, 'unavailable', FLEET_REASON_NO_TERMINAL));
    return;
  }
  const machine = typeof msg.machine === 'string' ? msg.machine : '';
  const session = typeof msg.session === 'string' ? msg.session : '';
  cloudOf(context)
    .openTerminal(ptyManager, machine, session)
    .then((terminalId) => send({ type: 'fleetTerminalOpened', requestId, terminalId }))
    .catch((error: unknown) => send(failure(requestId, error)));
}

function createTask(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const machine = typeof msg.machine === 'string' ? msg.machine : '';
  const slug = typeof msg.slug === 'string' ? msg.slug : '';
  const prompt = typeof msg.prompt === 'string' ? msg.prompt : '';
  cloudOf(context)
    .createTask(machine, msg.repo, slug, prompt, msg.engine)
    .then((session) => send({ type: 'fleetTaskCreated', requestId, machine, session }))
    .catch((error: unknown) => send(failure(requestId, error)));
}

/** Only a path the machine itself reported to the hub may be read: the board never browses arbitrary folders. */
function readDiff(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const machine = typeof msg.machine === 'string' ? msg.machine : '';
  const path = typeof msg.path === 'string' ? msg.path : '';
  const fleet = context.fleet ?? defaultFleetHubClient;
  fleet
    .fetchFleet()
    .then(async (response) => {
      const reported = response.machines.some(
        (entry) => entry.agent_id === machine && entry.repos.some((repo) => repo.path === path),
      );
      if (!reported) {
        send(commandResult(requestId, 'failed', FLEET_REASON_NOT_REPORTED));
        return;
      }
      const diff = await cloudOf(context).readDiff(machine, path);
      send({ type: 'fleetDiff', requestId, machine, path, text: diff.text, truncated: diff.truncated });
    })
    .catch((error: unknown) => send(failure(requestId, error)));
}

function sendCloudComment(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const machine = typeof msg.machine === 'string' ? msg.machine : '';
  const path = typeof msg.path === 'string' ? msg.path : '';
  const branch = typeof msg.branch === 'string' ? msg.branch : '';
  const session = typeof msg.session === 'string' ? msg.session : '';
  if (
    machine === '' ||
    path === '' ||
    branch === '' ||
    session === '' ||
    typeof msg.file !== 'string' ||
    typeof msg.line !== 'number' ||
    typeof msg.snippet !== 'string' ||
    typeof msg.content !== 'string'
  ) {
    send(commandResult(requestId, 'failed', FLEET_REASON_BAD_INPUT));
    return;
  }
  const fleet = context.fleet ?? defaultFleetHubClient;
  fleet
    .fetchFleet()
    .then(async (response) => {
      const report = response.machines.find((entry) => entry.agent_id === machine);
      const fresh = report !== undefined && response.now - report.received_at <= FLEET_STALE_AFTER_MS;
      const repo = report?.repos.find((entry) => entry.path === path && entry.branch === branch);
      const reportedSession = report?.tmux?.find(
        (entry) =>
          entry.name === session &&
          entry.branch === branch &&
          typeof entry.cwd === 'string' &&
          (entry.cwd === path || entry.cwd.startsWith(`${path}/`)),
      );
      if (!fresh || repo === undefined || reportedSession === undefined) {
        send(commandResult(requestId, 'failed', FLEET_REASON_NOT_REPORTED));
        return;
      }
      await cloudOf(context).sendDiffComment(machine, session, {
        file: msg.file as string,
        line: msg.line as number,
        snippet: msg.snippet as string,
        content: msg.content as string,
      });
      send({ type: 'fleetCommandResult', requestId, ok: true, code: 'success' });
    })
    .catch((error: unknown) => send(failure(requestId, error)));
}

function runLocalBranchAction(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const actions: readonly FleetBranchActionName[] = ['push', 'create-draft', 'ready', 'delete-remote'];
  const action = typeof msg.action === 'string' && actions.includes(msg.action as FleetBranchActionName)
    ? msg.action as FleetBranchActionName
    : undefined;
  const checkout = typeof msg.checkout === 'string' ? msg.checkout : '';
  const branch = typeof msg.branch === 'string' ? msg.branch : '';
  if (action === undefined || checkout === '' || checkout.length > 2000 || branch === '' || branch.length > 255) {
    send(commandResult(requestId, 'failed', FLEET_REASON_BAD_INPUT));
    return;
  }
  if (context.ledger === null) {
    send(commandResult(requestId, 'unavailable', 'Dữ liệu nhánh cục bộ chưa khả dụng.'));
    return;
  }
  void context.ledger.getView()
    .then(async (view) => {
      const reported = view.repos.some((repo) =>
        repo.worktrees.some((worktree) => worktree.path === checkout && worktree.branch === branch),
      );
      if (!reported) {
        send(commandResult(requestId, 'failed', 'Checkout không nằm trong danh sách nhánh cục bộ.'));
        return;
      }
      const result = await runFleetBranchAction({ action, checkout, branch }, { run: context.processRunner });
      send(result.ok
        ? { type: 'fleetCommandResult', requestId, ok: true, code: 'success' }
        : commandResult(requestId, 'failed', result.reason));
    })
    .catch(() => send(commandResult(requestId, 'failed', FLEET_REASON_COMMAND_FAILED)));
}

/** Validates the fixed command shape again (the hub and the machine check it too) and queues it through the board's command key. */
function queueRemoteCommand(
  msg: Record<string, unknown>,
  requestId: string,
  send: (message: ServerMessage) => void,
  context: FleetCommandContext,
): void {
  const verb = FLEET_COMMAND_VERBS.find((candidate) => candidate === msg.verb);
  const machine = typeof msg.machine === 'string' ? msg.machine : '';
  const pathOk = msg.path === undefined || (typeof msg.path === 'string' && msg.path !== '' && msg.path.length <= FLEET_COMMAND_PATH_MAX);
  const branchOk = msg.branch === undefined || (typeof msg.branch === 'string' && FLEET_COMMAND_BRANCH.test(msg.branch));
  if (verb === undefined || !FLEET_MACHINE_NAME.test(machine) || !pathOk || !branchOk) {
    send(commandResult(requestId, 'failed', FLEET_REASON_BAD_INPUT));
    return;
  }
  const command: FleetCommandInput = {
    machine,
    verb,
    ...(typeof msg.path === 'string' ? { path: msg.path } : {}),
    ...(typeof msg.branch === 'string' ? { branch: msg.branch } : {}),
  };
  (context.commands ?? defaultCommandService)
    .queue(command)
    .then(() => send({ type: 'fleetCommandResult', requestId, ok: true, code: 'success' }))
    .catch((error: unknown) => send(commandFailure(requestId, error)));
}

/** The hub's own words reach the board for a refused command; anything else stays generic. */
function commandFailure(requestId: string, error: unknown): ServerMessage {
  if (error instanceof FleetUnavailableError) return commandResult(requestId, 'unavailable', FLEET_REASON_UNAVAILABLE);
  if (error instanceof Error && (error.name === 'FleetCommandKeyError' || error.message.startsWith('Hub từ chối lệnh'))) {
    return commandResult(requestId, 'failed', error.message);
  }
  return commandResult(requestId, 'failed', FLEET_REASON_COMMAND_FAILED);
}

function failure(requestId: string, error: unknown): ServerMessage {
  if (error instanceof CloudControlError) {
    if (error.code === 'bad_input') return commandResult(requestId, 'failed', FLEET_REASON_BAD_INPUT);
    if (error.code === 'no_machine') return commandResult(requestId, 'unavailable', FLEET_REASON_NO_MACHINE);
    return commandResult(requestId, 'failed', error.message);
  }
  return commandResult(requestId, 'failed', FLEET_REASON_COMMAND_FAILED);
}

function commandResult(
  requestId: string,
  code: 'forbidden' | 'unavailable' | 'failed',
  reason: string,
): ServerMessage {
  return { type: 'fleetCommandResult', requestId, ok: false, code, reason };
}
