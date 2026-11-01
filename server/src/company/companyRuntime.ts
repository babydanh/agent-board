/**
 * companyRuntime: the effects the coordinator cannot perform itself.
 *
 * The coordinator owns durable truth — Contracts, the task DAG, approvals,
 * questions, the journal. This module owns everything that needs a real
 * process: launching OMP, gating its tools, running approved verification,
 * forwarding output, and letting a user watch a run's terminal.
 *
 * The rules that shape the implementation:
 *
 *  - The model is not the authority. A company tool payload is validated field
 *    by field, and the session id and run epoch are stamped from the
 *    authenticated bridge frame AFTER the payload is read, so no model-supplied
 *    field can name a different run. Unknown keys refuse rather than pass
 *    through: an invented key is either a bug or an attempt, and neither is
 *    something to forward.
 *  - Nothing runs before it is durable. A session, its counter and the routing
 *    decision are committed through the coordinator's own journal before a
 *    process is started, so a crash mid-launch leaves a record rather than an
 *    orphan.
 *  - No faked capability. An attachment is delivered as real content or the
 *    prompt is refused; an approved verification command runs or its blocker is
 *    recorded. There is no third path that looks like success.
 *  - Recovery never resumes work. A run whose process vanished is reported as
 *    such; restarting it is the user's decision.
 *  - Locks are released when the work is actually finished — after the tools go
 *    quiet, not when a result arrives while a child call is still running.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  AgentInfo,
  AgentToolUsage,
  Attempt,
  CompanyArchitectureIssue,
  CompanyChange,
  CompanyDiagnostics,
  CompanyEvent,
  CompanyModelCatalogEntry,
  CompanyPrompt,
  CompanyReport,
  CompanyRole,
  CompanySession,
  CompanyState,
  Contract,
  PromptAttachment,
  Question,
  QuestionAnswerInput,
  QuestionOption,
  QuestionPrompt,
  RoleProfile,
  SubmitPromptInput,
  Task,
  UsageRecord,
} from '../../../core/src/company.js';
import type { CompanySessionInsight, ServerMessage } from '../../../core/src/messages.js';
import type { CompanyTerminalGateway } from './clientCommands.js';
import type {
  CompanySessionAction,
  ContractDecision,
  ReviewerResultInput,
  VerificationOutcome,
  VerificationRequest,
  WorkerTaskResultInput,
  WorkspaceChangeInput,
} from './companyCoordinator.js';
import {
  CHAT_REOPEN_WITHOUT_FILE_MESSAGE,
  CompanyOwnershipError,
  type CompanySessionControlResult,
  WorkspaceCompanyCoordinator,
  WorkspaceCompanyCoordinatorEffects,
} from './companyCoordinatorRuntime.js';
import { approvedCommandsByCriterion, approvedVerificationCommand } from './companyEngine.js';
import { CompanyError } from './companyError.js';
import {
  type NativeLaunchInput,
  type NativeLaunchResolution,
  resolveNativeLaunch,
} from './companyNativeLaunch.js';
import { buildCompanyReport } from './companyReport.js';
import type { CompanyStore } from './companyStore.js';
import { runnerPtySessionId, RunnerTerminalGateway } from './companyTerminalGateway.js';
import {
  COMPANY_ATTACHMENT_MAX_BYTES,
  COMPANY_DEFAULT_TERMINAL_COLS,
  COMPANY_DEFAULT_TERMINAL_ROWS,
  COMPANY_IDLE_PARK_SECONDS,
  COMPANY_MAX_LIVE_RUNNERS,
  COMPANY_MAX_PROMPT_BYTES,
  COMPANY_MAX_RETAINED_SESSIONS,
  COMPANY_MAX_WORKERS,
  COMPANY_MODEL_CATALOG_TTL_MS,
} from './constants.js';
import { type RouteDecision, routePrompt } from './contextRouter.js';
import type { ContractDraftProposal } from './contractDraft.js';
import { buildSessionHandoff, renderHandoffText } from './handoff.js';
import { ROLE_LABELS } from './labels.js';
import {
  buildCompanyModelCatalog,
  buildCompanyModelCatalogFromBridge,
  type OmpModelDescriptor,
} from './modelCatalog.js';
import {
  type OmpBridgeQuestionAnswer,
  OmpBridgeRpcError,
  type OmpBridgeRpcRequest,
  type OmpBridgeSendPrompt,
  type OmpBridgeSubagentAuthorization,
  type OmpBridgeToolAuthorization,
} from './ompBridge.js';
import { readOmpModelsCatalog } from './ompModelsCatalog.js';
import {
  createOmpRunner,
  type OmpRunner,
  type OmpRunnerCommand,
  type OmpRunnerOptions,
} from './ompRunner.js';
import { ompSessionsRoot, removeSessionFileWithin } from './ompSessionFiles.js';
import {
  actionDigest,
  type ApprovedVerificationCommand,
  decideToolCall,
} from './permissionPolicy.js';
import type {
  OwnershipVerdict,
  RegisterRunInput,
  ShutdownReport,
  SupervisedRunRecord,
} from './processSupervisor.js';
import { ProcessSupervisor } from './processSupervisor.js';
import { parseSessionInsight } from './sessionInsight.js';
import type { PrerequisiteCheck } from './verificationRunner.js';

/**
 * The supervisor surface this runtime uses.
 *
 * Every member is REQUIRED and typed exactly as `ProcessSupervisor` declares it,
 * so the concrete class satisfies this port with no cast: a production run can
 * never be wired to a supervisor that cannot prove ownership. `verifyRunOwnership`
 * in particular is not optional — a pid this runtime cannot prove is not one it
 * may signal.
 */
export interface CompanySupervisorPort {
  registerRun(input: RegisterRunInput): SupervisedRunRecord;
  notifyExit(
    runId: string,
    detail?: { exitCode?: number; signal?: number; expected?: boolean },
  ): SupervisedRunRecord | undefined;
  pause(
    runId: string,
    runEpoch: number,
    options?: { quiesceTimeoutMs?: number },
  ): Promise<SupervisedRunRecord>;
  kill(
    runId: string,
    runEpoch: number,
    options?: { quiesceTimeoutMs?: number },
  ): Promise<SupervisedRunRecord>;
  getRun(runId: string): SupervisedRunRecord | undefined;
  verifyRunOwnership(runId: string, runEpoch: number): Promise<OwnershipVerdict>;
  dispose(options?: { shutdownGraceMs?: number }): Promise<ShutdownReport>;
}

import { type OmpAgentFields, ompAgentFields, readOmpTranscript } from '../herdr/ompTranscript.js';
import { PtyClient, type PtyClientOptions } from './ptyClient.js';
import { buildRolePacket, roleBriefForProfile, roleBriefText } from './roleBriefs.js';
import { Scheduler } from './scheduler.js';
import {
  isSessionLogId,
  removeSessionLog,
  SessionLog,
  sessionLogDirectory,
  type SessionLogInput,
  SKILL_READ_LOG_PREFIX,
  tallySessionTools,
} from './sessionLog.js';
import {
  isSquadWorkstream,
  sessionHoldsRunner,
  SessionPool,
  type SessionRequest,
} from './sessionPool.js';
import type { UsageLedger } from './usageService.js';
import { discoverVerificationProfiles } from './verificationDiscovery.js';
import { squadWorkstreamRole } from './workItems/workItemScheduler.js';
import { WorkspaceLockTable } from './workspaceLocks.js';

/** Image media types the native bridge can actually carry. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, true>> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
};

/** Roles that review approved work rather than produce it. */
type ReviewerRole = 'advisor' | 'qa' | 'judge';

/** How many repair attempts a task gets before it is reported as blocked. */
const MAX_REPAIR_ATTEMPTS = 3;

/** How often the pool is asked which idle sessions may be parked. */
const PARK_SWEEP_MS = 15_000;

/** Artifact reads are paged; a page large enough for any real image. */
const ARTIFACT_PAGE_BYTES = 256 * 1024;

/** The tail of a verification command's output kept in the session log. */
const SESSION_LOG_OUTPUT_TAIL_BYTES = 1200;

/** Most tool-usage rows one session description carries. */
const AGENT_TOOL_USAGE_LIMIT = 50;

/** Longest skill name a `read` may log under its own `skill://` text. */
const SKILL_NAME_LOG_LIMIT = 300;

/** Note on a description the live process could not answer, read from the omp transcript. */
const SESSION_INFO_TRANSCRIPT_NOTE =
  'Không hỏi trực tiếp được phiên, nên số liệu lấy từ transcript omp đã lưu. Danh sách kỹ năng chỉ gồm các kỹ năng đã được đọc trong transcript.';

/** Note on a description that rests on the company record alone. */
const SESSION_INFO_RECORD_NOTE =
  'Không hỏi trực tiếp được phiên và không đọc được transcript omp, nên chỉ có số liệu từ bản ghi công ty.';

/** The most-used tools first, bounded to what one session description carries. */
function toolUsageOf(counts: ReadonlyMap<string, number>): AgentToolUsage[] {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, AGENT_TOOL_USAGE_LIMIT);
}

/** Board fields an omp transcript supplies, or `undefined` when it cannot be read. */
async function readTranscriptFields(sessionFile: string): Promise<OmpAgentFields | undefined> {
  try {
    return ompAgentFields(await readOmpTranscript(sessionFile));
  } catch {
    return undefined;
  }
}

/** A native image, as the bridge accepts it: canonical base64 of raw bytes. */
type BridgeImage = { mimeType: string; data: string };

/** What a run actually launched with, after the live catalog resolved the request. */
interface LaunchProfile {
  readonly profile: RoleProfile;
  /** The native catalog id, which is what the session reports as effective. */
  readonly effectiveModel: string;
}

interface ActiveRun {
  readonly sessionId: string;
  readonly runId: string;
  readonly runEpoch: number;
  readonly role: CompanyRole;
  readonly runner: OmpRunner;
  profile: RoleProfile;
  busy: boolean;
  readonly liveTools: Map<string, string>;
  /** Approval questions this run raised, keyed by the digest that binds them. */
  readonly approvals: Map<string, string>;
  nativeSessionId?: string;
  nativeSessionPath?: string;
  effectiveModel?: string;
  stopping: boolean;
  unsubscribe: () => void;
}

export interface CompanyRuntimeDeps {
  startPtyClient(options: PtyClientOptions): Promise<PtyClient>;
  createRunner(options: OmpRunnerOptions): OmpRunner;
  createSupervisor(): CompanySupervisorPort;
  resolveLaunch(input: NativeLaunchInput): NativeLaunchResolution;
  readOmpModels(command: OmpRunnerCommand, cwd: string): Promise<OmpModelDescriptor[]>;
  now(): string;
  setInterval(handler: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

export interface CompanyRuntimeOptions {
  readonly store: CompanyStore;
  readonly usageLedger: UsageLedger;
  readonly getCoordinator: () => WorkspaceCompanyCoordinator;
  readonly onMessage: (msg: ServerMessage) => void;
  readonly runnerCommand?: OmpRunnerCommand;
  readonly extensionPath?: string;
  readonly helperPath?: string;
  /** Injection seam for tests; production uses the real implementations. */
  readonly deps?: Partial<CompanyRuntimeDeps>;
}

export interface CompanyRuntime {
  readonly effects: WorkspaceCompanyCoordinatorEffects;
  readonly terminal: CompanyTerminalGateway;
  setLiveRunnerLimits(live: number, retained: number): void;
  modelCatalog(): Promise<CompanyModelCatalogEntry[]>;
  /**
   * What one managed session has loaded: working directory, model, thinking,
   * session file, tools with source and active flag, skills with read status, and
   * tool usage counts. Read-only; an unknown session is `session_not_found`.
   */
  sessionInfo(sessionId: string): Promise<AgentInfo>;
  /**
   * Machine-check one Contract-declared environment prerequisite.
   *
   * Only facts this process can observe count: a path that exists, a directory
   * that exists, a manifest whose declared name matches. Nothing here consults
   * a model, a network or a credential store, so an unsupported prerequisite is
   * reported rather than assumed satisfied.
   */
  readonly checkPrerequisite: PrerequisiteCheck;
  /** Whether a viewer currently holds this session's terminal. */
  isTerminalAttached(sessionId: string): boolean;
  dispose(): Promise<void>;
}

/** What a prerequisite check can conclude, and why. */
export type PrerequisiteVerdict =
  { readonly satisfied: true } | { readonly satisfied: false; readonly reason: string };

/** Prerequisite kinds that are decided against this workspace only. */
const WORKSPACE_ONLY_PREREQUISITES: Readonly<Record<string, true>> = {
  'file:': true,
  'dir:': true,
  'package.json:': true,
  '': true,
};

/**
 * Decide one declared prerequisite from facts on this machine.
 *
 * Anything outside the allowlist is UNSUPPORTED, and unsupported is not
 * satisfied: verification blocks on it rather than running against a guess.
 */
function checkDeclaredPrerequisite(
  requirement: string,
  workspaceRoot: string,
): PrerequisiteVerdict {
  const colon = requirement.indexOf(':');
  const kind = colon < 1 ? '' : requirement.slice(0, colon);
  const value = colon < 1 ? requirement.trim() : requirement.slice(colon + 1).trim();
  // The slice stops BEFORE the colon while the allowlist spells a kind WITH it,
  // so one key is derived here and used for every comparison below. Mixing the
  // two spellings made every typed prerequisite look like an unknown kind, then
  // like a filesystem path once it passed the allowlist.
  const kindKey = colon < 1 ? '' : `${kind}:`;
  if (WORKSPACE_ONLY_PREREQUISITES[kindKey] !== true) {
    return {
      satisfied: false,
      reason: `${requirement} declares no checkable prerequisite kind; only ${Object.keys(
        WORKSPACE_ONLY_PREREQUISITES,
      )
        .filter((entry) => entry !== '')
        .join(', ')} and a bare workspace path can be verified.`,
    };
  }
  if (value === '') {
    return { satisfied: false, reason: `${requirement} names nothing to check.` };
  }
  if (kindKey === 'package.json:') {
    return checkManifestName(workspaceRoot, value);
  }
  const target = path.resolve(workspaceRoot, value);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(target);
  } catch {
    return { satisfied: false, reason: `${target} does not exist.` };
  }
  const wantDirectory = kindKey === 'dir:';
  if (wantDirectory === stats.isDirectory()) return { satisfied: true };
  return {
    satisfied: false,
    reason: `${target} is not ${wantDirectory ? 'a directory' : 'a file'}.`,
  };
}

/**
 * The manifest's own declared name, compared with what the prerequisite claims.
 * Reading the file is the whole check: no registry, no global root, no install.
 */
function checkManifestName(workspaceRoot: string, expectedName: string): PrerequisiteVerdict {
  const manifestPath = path.join(workspaceRoot, 'package.json');
  let declared: string | undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === 'string') declared = name;
    }
  } catch {
    return { satisfied: false, reason: `${manifestPath} could not be read.` };
  }
  if (declared === undefined) {
    return { satisfied: false, reason: `${manifestPath} declares no name.` };
  }
  return declared === expectedName
    ? { satisfied: true }
    : { satisfied: false, reason: `${manifestPath} declares ${declared}, not ${expectedName}.` };
}

const DEFAULT_DEPS: CompanyRuntimeDeps = {
  startPtyClient: (options) => PtyClient.start(options),
  createRunner: (options) => createOmpRunner(options),
  createSupervisor: () => new ProcessSupervisor(),
  resolveLaunch: (input) => resolveNativeLaunch(input),
  readOmpModels: (command, cwd) => readOmpModelsCatalog({ command, cwd }),
  now: () => new Date().toISOString(),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle),
};

/** Read a non-empty string field, or undefined when it is absent or wrong. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Read a finite number field, or undefined. */
function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Read a plain-object field, or undefined. Arrays are not records. */
function readRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

/** Whether a value is a plain object rather than an array or a primitive. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read an array-of-records field, refusing any element that is not a record. */
function readRecordArray(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  const rows: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    rows.push(Object.fromEntries(Object.entries(entry)));
  }
  return rows;
}

/** Read an array-of-strings field, refusing any element that is not a string. */
function readStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  const rows: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return undefined;
    rows.push(entry);
  }
  return rows;
}

/**
 * Refuse a payload that carries a key this handler does not understand.
 *
 * Forwarding an unrecognised key would mean trusting a field the runtime never
 * validated, which is exactly what the other checks exist to prevent.
 */
function assertKnownKeys(payload: Record<string, unknown>, known: readonly string[]): void {
  const allowed = new Set(known);
  const unexpected = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new OmpBridgeRpcError(
      'company_payload_unknown_field',
      `Refused an unrecognised payload field: ${unexpected.join(', ')}.`,
    );
  }
}

/** The deterministic id an approval question is stored under. */
function approvalQuestionId(digest: string): string {
  return `q_${digest.slice(0, 24)}`;
}

class NativeCompanyRuntime implements CompanyRuntime {
  readonly effects: WorkspaceCompanyCoordinatorEffects;
  terminal!: CompanyTerminalGateway;

  /** The last CLI catalog read, reused until it is older than the TTL. */
  private hostCatalog:
    { readonly startedAt: number; readonly read: Promise<CompanyModelCatalogEntry[]> } | undefined;
  private readonly store: CompanyStore;
  private readonly usageLedger: UsageLedger;
  private readonly getCoordinator: () => WorkspaceCompanyCoordinator;
  private readonly onMessage: (msg: ServerMessage) => void;
  private readonly deps: CompanyRuntimeDeps;
  private readonly launch: NativeLaunchResolution;
  private readonly supervisor: CompanySupervisorPort;
  private readonly pool: SessionPool;
  private readonly scheduler: Scheduler;
  private readonly sessionLog: SessionLog;
  private readonly gateway: RunnerTerminalGateway;
  private readonly runs = new Map<string, ActiveRun>();
  private readonly handoffs = new Map<string, string>();
  /** Native child spawns holding a shared model-call lease, keyed by spawn key. */
  private readonly childLeases = new Map<string, { sessionId: string; runEpoch: number }>();
  /** Native questions being recorded from their own terminal dialog, which already has the answer. */
  private readonly terminalAnswers = new Set<string>();
  private ptyClient!: PtyClient;
  private ptySubscription: (() => void) | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  private disposed = false;
  private dispatching = false;
  private dispatchPending = false;
  private runCounter = 0;
  private pendingRecovery: CompanyChange[] = [];

  private constructor(options: CompanyRuntimeOptions, deps: CompanyRuntimeDeps) {
    this.store = options.store;
    this.usageLedger = options.usageLedger;
    this.getCoordinator = options.getCoordinator;
    this.onMessage = options.onMessage;
    this.deps = deps;
    this.sessionLog = new SessionLog({
      directory: sessionLogDirectory(this.store.namespaceDir),
      now: () => this.deps.now(),
      onEntry: (sessionId, entry) => {
        this.onMessage({ type: 'companySessionLog', sessionId, replay: false, entries: [entry] });
      },
    });
    this.launch = deps.resolveLaunch({
      ...(options.runnerCommand === undefined ? {} : { runnerCommand: options.runnerCommand }),
      ...(options.extensionPath === undefined ? {} : { extensionPath: options.extensionPath }),
      ...(options.helperPath === undefined ? {} : { helperPath: options.helperPath }),
    });
    this.supervisor = deps.createSupervisor();
    this.pool = new SessionPool({
      limits: {
        maxRetainedSessions: COMPANY_MAX_RETAINED_SESSIONS,
        maxLiveRunners: COMPANY_MAX_LIVE_RUNNERS,
        idleParkSeconds: COMPANY_IDLE_PARK_SECONDS,
      },
    });
    this.scheduler = new Scheduler({
      locks: new WorkspaceLockTable({ workspaceRoot: options.store.workspacePath }),
      limits: {
        maxWorkers: COMPANY_MAX_WORKERS,
        maxConcurrentModelCalls: COMPANY_MAX_WORKERS,
        maxLiveRunners: COMPANY_MAX_LIVE_RUNNERS,
      },
    });
    this.gateway = new RunnerTerminalGateway({
      client: {
        write: (sessionId, data) => this.ptyClient.write(sessionId, data),
        resize: (sessionId, cols, rows) => this.ptyClient.resize(sessionId, cols, rows),
        snapshot: (sessionId) => this.ptyClient.snapshot(sessionId),
      },
      isLive: (sessionId, runEpoch) => this.isRunLive(sessionId, runEpoch),
      size: () => ({ cols: COMPANY_DEFAULT_TERMINAL_COLS, rows: COMPANY_DEFAULT_TERMINAL_ROWS }),
      liveEpoch: (sessionId) => this.runs.get(sessionId)?.runEpoch,
      events: (listener) => this.ptyClient.onEvent(listener),
    });
    this.terminal = this.gateway;
    this.effects = {
      getModelCatalog: () => this.modelCatalog(),
      diagnostics: () => this.diagnostics(),
      onPromptSubmitted: (prompt, input) => this.onPromptSubmitted(prompt, input),
      openChatSession: (input) => this.openChatSession(input),
      parkSquadSession: (sessionId) => this.parkSquadSession(sessionId),
      onContractDecision: (contract, decision) => this.onContractDecision(contract, decision),
      onQuestionAnswered: (question, input) => this.onQuestionAnswered(question, input),
      controlSession: (session, action, runEpoch) => this.controlSession(session, action, runEpoch),
      deleteSession: (sessionId, session) => this.deleteSession(sessionId, session),
      onSettingsUpdated: (profiles) => this.onSettingsUpdated(profiles),
      onStateChanged: (event) => this.onStateChanged(event),
      recover: (state) => this.recover(state),
      // Without an event after a restart no dispatch pass ran, so a dead run stayed "busy" on the board.
      onStarted: () => this.requestDispatch(),
      verifyControlOwnership: (session, action, runEpoch) =>
        this.verifyControlOwnership(session, action, runEpoch),
      dispose: () => this.dispose(),
    };
  }

  /**
   * Decide one declared prerequisite, in the shape the verification runner asks
   * for: a reason string when it is not met, `null` when it is. Unsupported is
   * not met, so a Contract naming something this machine cannot check blocks
   * before any command starts.
   */
  readonly checkPrerequisite: PrerequisiteCheck = async (requirement) => {
    const verdict = checkDeclaredPrerequisite(requirement, this.store.workspacePath);
    return verdict.satisfied ? null : verdict.reason;
  };

  /**
   * Build and start the runtime. Prerequisites resolve first, so a machine
   * without a usable OMP is told so once, with a code the caller can branch on.
   */
  static async open(options: CompanyRuntimeOptions): Promise<CompanyRuntime> {
    const deps: CompanyRuntimeDeps = { ...DEFAULT_DEPS, ...options.deps };
    const runtime = new NativeCompanyRuntime(options, deps);
    runtime.ptyClient = await deps.startPtyClient({ helperScript: runtime.launch.helperPath });
    runtime.ptySubscription = runtime.ptyClient.onEvent((event) => runtime.onPtyEvent(event));
    const timer = deps.setInterval(() => {
      void runtime.parkIdleSessions().catch((error) => {
        console.error('[CompanyRuntime] Park sweep failed.', error);
      });
    }, PARK_SWEEP_MS);
    timer.unref?.();
    runtime.timers.push(timer);
    return runtime;
  }

  // ── Primitives ───────────────────────────────────────────────────────────

  private coordinator(): WorkspaceCompanyCoordinator {
    return this.getCoordinator();
  }

  /**
   * Read the durable state.
   *
   * There is deliberately no shared "current revision" field: two runtime
   * turns can be in flight at once (a native event landing while a dispatch is
   * running), and a single mutable value let one turn's commit be judged
   * against another turn's snapshot, which surfaced as a spurious
   * `company_revision_conflict` on a batch that was perfectly valid. Every
   * commit instead reads the revision at the moment it writes.
   */
  private state(): CompanyState {
    return this.coordinator().readState();
  }

  /** Appends one entry to a session's durable log, attributed to its active task unless given. */
  private logEntry(
    sessionId: string,
    runEpoch: number,
    entry: Omit<SessionLogInput, 'runEpoch' | 'taskId'>,
    taskId?: string,
  ): void {
    const attributed = taskId ?? this.state().sessions[sessionId]?.activeTaskId;
    this.sessionLog.record(sessionId, {
      ...entry,
      runEpoch,
      ...(attributed === undefined ? {} : { taskId: attributed }),
    });
  }

  /** Logs a verification run for the Lệnh tab: the command line, then the tail of its output. */
  private async logCommand(
    run: ActiveRun,
    request: VerificationRequest,
    outcome: VerificationOutcome,
  ): Promise<void> {
    const evidence = this.state().evidence[outcome.evidenceId];
    const commandLine =
      evidence === undefined
        ? `Lệnh ${outcome.commandId} bị chặn trước khi chạy.`
        : [evidence.command.executable, ...evidence.command.argv].join(' ');
    const tail =
      evidence === undefined
        ? ''
        : (await this.outputTail(evidence.stdoutArtifactId)) ||
          (await this.outputTail(evidence.stderrArtifactId));
    this.logEntry(
      run.sessionId,
      run.runEpoch,
      {
        kind: 'command',
        text: tail === '' ? commandLine : `${commandLine}\n${tail}`,
        ok: outcome.status === 'passed',
        ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
      },
      request.taskId,
    );
  }

  /** The last bytes of a command's output artifact as text; '' when there is nothing to read. */
  private async outputTail(artifactId: string | undefined): Promise<string> {
    if (artifactId === undefined) return '';
    try {
      const { totalBytes } = await this.store.readArtifact(artifactId, 0, 1);
      const offset = Math.max(0, totalBytes - SESSION_LOG_OUTPUT_TAIL_BYTES);
      const page = await this.store.readArtifact(artifactId, offset, SESSION_LOG_OUTPUT_TAIL_BYTES);
      return Buffer.from(page.dataBase64, 'base64')
        .toString('utf8')
        .replace(/^\uFFFD+/u, '')
        .trim();
    } catch {
      return '';
    }
  }

  /** Logs a QA or Judge verdict in the session that gave it, with the reviewer's notes. */
  private logVerdict(run: ActiveRun, role: 'qa' | 'judge', input: ReviewerResultInput): void {
    const passed = input.verdict === 'pass';
    const headline = passed
      ? `${ROLE_LABELS[role]} chấp thuận.`
      : `${ROLE_LABELS[role]} yêu cầu sửa.`;
    this.logEntry(
      run.sessionId,
      run.runEpoch,
      { kind: 'verdict', text: [headline, ...input.notes].join('\n'), ok: passed },
      input.taskId,
    );
  }

  /** True while this runtime still holds the run a terminal viewer or a bridge
   *  frame named — the single check every epoch guard shares. */
  private isRunLive(sessionId: string, runEpoch: number): boolean {
    return this.runs.get(sessionId)?.runEpoch === runEpoch;
  }

  /** A viewer holds a session's terminal while the run behind it is still alive. */
  isTerminalAttached(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    return run !== undefined && this.gateway.hasViewer(run.sessionId, run.runEpoch);
  }

  /**
   * Journal a batch of runtime changes, on this runtime's OWN queue.
   *
   * Effects run inside the coordinator's serialized operation, so a write made
   * from one cannot await the coordinator: it would wait on the very operation
   * that is waiting for it. Every runtime write therefore goes through this
   * chain, which preserves order (a session is still persisted before its
   * process starts) and drains once the coordinator's queue lets go.
   */
  private async commit(changes: CompanyChange[], derivedFrom: number): Promise<void> {
    if (changes.length === 0) return;
    const coordinator = this.coordinator();
    try {
      await coordinator.commitRuntimeChanges(changes, derivedFrom);
    } catch (error) {
      // The caller derived these whole-record puts from revision .
      // A conflict means another writer moved first, so the batch is NOT rebased:
      // replaying it onto a newer head would resurrect a stale epoch, counter or
      // task outcome. The dispatcher recomputes from the fresh state instead.
      if (error instanceof CompanyError && error.code === 'company_revision_conflict') {
        this.requestDispatch();
      }
      throw error;
    }
  }

  private profileFor(state: CompanyState, role: CompanyRole): RoleProfile {
    const profile = state.settings.roleProfiles[role];
    if (profile === undefined) {
      throw new CompanyError('role_profile_missing', `No role profile is configured for ${role}.`);
    }
    return profile;
  }

  private workstreamOf(contract: Contract): string {
    return contract.tasks[0]?.workstreamId ?? contract.id;
  }

  // ── Model catalog ────────────────────────────────────────────────────────

  /**
   * The models this machine can run. The installed OMP answers from
   * `omp models --json`, which starts no session, so a board with no Director
   * still has a catalog. That read is reused for {@link COMPANY_MODEL_CATALOG_TTL_MS},
   * because every launch asks for the catalog. When the read fails, a live run
   * answers from inside its own process, which holds the same credentials. With
   * neither, the refusal carries the reason.
   */
  async modelCatalog(): Promise<CompanyModelCatalogEntry[]> {
    try {
      return await this.readHostCatalog();
    } catch (readError) {
      const run = this.liveCatalogRun();
      if (run === undefined) throw readError;
      const catalog = await run.runner.requestModelCatalog(run.runEpoch);
      return buildCompanyModelCatalogFromBridge(catalog, {
        sessionId: run.sessionId,
        runEpoch: run.runEpoch,
      });
    }
  }

  /**
   * One CLI read, shared by concurrent callers and reused until it ages out. A
   * failed read is dropped at once, so the next caller asks again.
   */
  private readHostCatalog(): Promise<CompanyModelCatalogEntry[]> {
    const startedAt = Date.parse(this.deps.now());
    const cached = this.hostCatalog;
    if (cached !== undefined && startedAt - cached.startedAt < COMPANY_MODEL_CATALOG_TTL_MS) {
      return cached.read;
    }
    const read = this.deps
      .readOmpModels(this.launch.command, this.store.workspacePath)
      .then((models) => buildCompanyModelCatalog(models));
    const entry = { startedAt, read };
    this.hostCatalog = entry;
    read.catch(() => {
      if (this.hostCatalog === entry) this.hostCatalog = undefined;
    });
    return read;
  }

  /**
   * What one managed session has loaded, for the board's session panel. A live
   * run is asked directly, so its model, thinking level, tools and skills are
   * what the process holds now. Without one, the answer falls back to the
   * durable record and says so. Tool and skill use always comes from the session
   * log, so it survives a restart either way.
   */
  async sessionInfo(sessionId: string): Promise<AgentInfo> {
    const session = this.state().sessions[sessionId];
    if (session === undefined) {
      throw new CompanyError('session_not_found', `Unknown session: ${sessionId}`);
    }
    const tally = await tallySessionTools(sessionLogDirectory(this.store.namespaceDir), sessionId);
    const toolUsage = toolUsageOf(tally.tools);
    const collectedAt = this.deps.now();
    const run = this.runs.get(sessionId);
    if (run !== undefined) {
      try {
        const live = await run.runner.requestSessionInfo(run.runEpoch);
        const sessionFile = live.sessionFile ?? session.nativeSessionPath;
        return {
          cwd: live.cwd,
          launchCwd: this.store.workspacePath,
          ...(live.model === undefined ? {} : { model: live.model }),
          ...(live.thinking === undefined ? {} : { thinking: live.thinking }),
          ...(sessionFile === undefined ? {} : { sessionFile }),
          tools: [...live.tools],
          skills: live.skills.map((skill) => ({
            name: skill.name,
            ...(skill.description === undefined ? {} : { description: skill.description }),
            used: tally.skills.has(skill.name),
          })),
          toolUsage,
          collectedFrom: 'live',
          collectedAt,
        };
      } catch {
        // The live answer is refused or unreachable; the durable record still answers.
      }
    }
    const sessionFile = session.nativeSessionPath;
    const transcript =
      sessionFile === undefined ? undefined : await readTranscriptFields(sessionFile);
    return {
      cwd: session.cwd ?? this.store.workspacePath,
      launchCwd: this.store.workspacePath,
      model: transcript?.model ?? session.effectiveModel ?? session.requestedModel,
      ...(transcript?.thinking === undefined ? {} : { thinking: transcript.thinking }),
      ...(sessionFile === undefined ? {} : { sessionFile }),
      ...(transcript === undefined ? {} : { tools: transcript.tools, skills: transcript.skills }),
      toolUsage,
      collectedFrom: 'transcript',
      collectedAt,
      note: transcript === undefined ? SESSION_INFO_RECORD_NOTE : SESSION_INFO_TRANSCRIPT_NOTE,
    };
  }

  /**
   * The run that answers a catalog question when the CLI read fails: the newest
   * live Director, else the newest live run of any role. Every run holds the same
   * credentials, and the bridge answers `models_request` for any of them.
   */
  private liveCatalogRun(): ActiveRun | undefined {
    const runs = [...this.runs.values()].sort((left, right) => right.runEpoch - left.runEpoch);
    return runs.find((run) => run.role === 'director') ?? runs[0];
  }

  diagnostics(): CompanyDiagnostics {
    const state = this.state();
    const sessions = Object.values(state.sessions);
    const tasks = Object.values(state.tasks);
    return {
      liveRunners: this.runs.size,
      modelLeases: this.scheduler.capacitySnapshot().modelCalls + this.childLeases.size,
      nativeJobs: [...this.runs.values()].reduce((total, run) => total + run.liveTools.size, 0),
      queuedTasks: tasks.filter((task) => task.status === 'ready' || task.status === 'failed')
        .length,
      pendingQuestions: Object.values(state.questions).filter((q) => q.status === 'pending').length,
      retainedSessions: sessions.filter((s) => s.status !== 'archived').length,
      archivedSessions: sessions.filter((s) => s.status === 'archived').length,
      terminalBufferedBytes: 0,
      ownedHandleCount: this.runs.size,
      measuredAt: this.deps.now(),
    };
  }

  // ── Prompt intake ────────────────────────────────────────────────────────

  private async onPromptSubmitted(prompt: CompanyPrompt, input: SubmitPromptInput): Promise<void> {
    const state = this.state();
    const route = routePrompt({
      delivery: input.delivery,
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.targetContractId === undefined ? {} : { targetContractId: input.targetContractId }),
      ...(input.targetSessionId === undefined ? {} : { targetSessionId: input.targetSessionId }),
      contracts: Object.values(state.contracts),
      sessions: Object.values(state.sessions),
      acceptedRelation: null,
    });
    if (route.strategy === 'undeliverable') {
      // Thrown rather than reported on the side: the caller answers the prompt
      // with exactly one command result, so a refusal cannot race a success.
      throw new CompanyError('prompt_undeliverable', route.reason);
    }

    const text = await this.readArtifactText(prompt.rawTextArtifactId);
    const session = await this.acquireSession(route, prompt.id);
    await this.commit(
      [
        {
          entity: 'prompt',
          op: 'put',
          id: prompt.id,
          value: {
            ...prompt,
            targetSessionId: session.id,
            ...(route.targetContractId === undefined
              ? {}
              : { targetContractId: route.targetContractId }),
            routingReason: route.reason,
          },
        },
      ],
      this.state().revision,
    );

    // Chat prompts reach the session exactly as typed, the way omp receives them.
    // Company prompts are wrapped in the role brief (and planning rules for the Director).
    const turn =
      input.mode === 'chat'
        ? text
        : session.role === 'director'
          ? this.composePlanningText(session, prompt, text)
          : this.composePromptText(session, text);
    await this.dispatchTurn(session.id, {
      text: turn,
      delivery: input.delivery,
      attachments: prompt.attachments ?? [],
    });
  }

  /**
   * Read a stored prompt body in full.
   *
   * Pages are concatenated as BYTES and decoded once at the end, so a multi-byte
   * character split across a page boundary survives: decoding per page would turn
   * one emoji into two replacement characters. The total is bounded by the same
   * ceiling the ingress path enforces, and an artifact larger than that is a real
   * error rather than a truncation.
   */
  private async readArtifactText(artifactId: string): Promise<string> {
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.store.readArtifact(artifactId, offset, ARTIFACT_PAGE_BYTES);
      chunks.push(Buffer.from(page.dataBase64, 'base64'));
      if (page.eof) break;
      offset += ARTIFACT_PAGE_BYTES;
      if (offset > COMPANY_MAX_PROMPT_BYTES) {
        throw new CompanyError(
          'prompt_body_too_large',
          `The stored prompt body exceeds the ${COMPANY_MAX_PROMPT_BYTES} byte ceiling.`,
        );
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * The turn a session receives.
   *
   * Order matters for the provider's prompt cache, which matches on a PREFIX:
   * everything after the first changed byte is re-sent and re-billed. The role
   * brief with NO packet is therefore emitted first and on its own, so the bytes
   * up to the end of it are identical for every turn of the same role and the
   * cache covers them. The packet carries the contract and task ids, which change
   * every turn, so it must come after — interleaving it into the brief, as this
   * used to, changed the prefix on every turn and left nothing to cache.
   */
  private composePromptText(session: CompanySession, body: string): string {
    const state = this.state();
    const brief = roleBriefForProfile(this.profileFor(state, session.role));
    const contract = this.contractForSession(state, session);
    const task = session.activeTaskId === undefined ? undefined : state.tasks[session.activeTaskId];
    const handoff = this.handoffs.get(session.id);
    const packet = buildRolePacket({
      role: session.role,
      ...(contract === undefined ? {} : { contract }),
      ...(task === undefined ? {} : { task }),
    });
    return `${roleBriefText(brief, packet)}${handoff === undefined ? '' : `\n${handoff}\n`}\n${body}\n`;
  }

  /**
   * The Director's planning turn.
   *
   * A Contract proposal must classify every prompt fragment by id, and the role
   * packet deliberately does not carry fragment ids, so the numbered fragment
   * table is rendered here from the prompt's own character ranges. The user's
   * text is reproduced in full and in order: nothing is summarised, sampled or
   * sliced, and the bridge chunks an oversized turn rather than truncating it.
   */
  private composePlanningText(
    session: CompanySession,
    prompt: CompanyPrompt,
    text: string,
  ): string {
    const rows = prompt.fragments
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((fragment) => {
        const body = text.slice(fragment.start, fragment.end);
        return `- fragment ${fragment.id} (chars ${fragment.start}-${fragment.end}): ${body}`;
      })
      .join('\n');
    const brief = this.composePromptText(
      session,
      `Plan the Contract for prompt ${prompt.id}. Classify every fragment below exactly once, unless the prompt asks for nothing to build (a greeting, thanks or small talk): then submit no Contract and ask nothing, and reply in one or two short Vietnamese sentences.\n\n${rows}\n\n${this.verificationProfileList()}`,
    );
    return `${brief}\n--- user prompt ${prompt.id} (verbatim) ---\n${text}\n`;
  }

  /**
   * The checks a "command" criterion may bind to, as the Director must name them.
   * Only profiles discovered in this workspace are listed: a binding to anything
   * else is dropped by the coordinator, so naming one here would be a promise
   * the Contract cannot keep.
   */
  private verificationProfileList(): string {
    const discovered = Object.values(this.state().settings.verificationProfiles).filter(
      (profile) => profile.criterionIds.length === 0,
    );
    if (discovered.length === 0) {
      return 'Verification profiles: none were discovered in this workspace, so no task can be proven done. Ask the user with company_ask_user to add a check (for example a package.json "test" script) before submitting a Contract.';
    }
    const lines = discovered.map(
      (profile) =>
        `- ${profile.id}: ${profile.commands.map((command) => [command.executable, ...command.argv].join(' ')).join('; ')}`,
    );
    return `Verification profiles a "command" criterion may bind to (by profileId):\n${lines.join('\n')}`;
  }

  private contractForSession(state: CompanyState, session: CompanySession): Contract | undefined {
    if (session.activeTaskId !== undefined) {
      const task = state.tasks[session.activeTaskId];
      const contract = task === undefined ? undefined : state.contracts[task.contractId];
      if (contract !== undefined) return contract;
    }
    return Object.values(state.contracts).find(
      (contract) => this.workstreamOf(contract) === session.workstreamId,
    );
  }

  /**
   * Get (or create) the session that must handle this prompt.
   *
   * The decision, the mint and the counter bump are committed BEFORE anything is
   * launched, so a launch failure still leaves a truthful session record.
   */
  private async acquireSession(route: RouteDecision, promptId: string): Promise<CompanySession> {
    const state = this.state();
    if (route.targetSessionId !== undefined) {
      const existing = state.sessions[route.targetSessionId];
      if (existing !== undefined) {
        // A parked session comes back at the next epoch, as the pool reopens one,
        // so events from its earlier run cannot be taken for this one's.
        if (existing.status === 'parked') {
          const runEpoch = existing.runEpoch + 1;
          await this.reopenSession(existing, runEpoch);
          return { ...existing, runEpoch, status: 'starting' };
        }
        this.pool.upsert(existing);
        return existing;
      }
    }
    return this.acquireNewSession(
      route.role,
      route.workstreamId ?? `${route.role === 'chat' ? 'chat' : 'ws'}-${promptId.slice(0, 8)}`,
    );
  }

  /**
   * Plan and mint a session for a workstream no live session holds yet.
   *
   * Chat is the user's own work, so when every runner is taken it may park one
   * idle session that owes nothing. Busy and waiting sessions keep their runner,
   * and so does everything else the parking check refuses.
   */
  private async acquireNewSession(
    role: CompanyRole,
    workstreamId: string,
    /** Directory the new session's process runs in; absent means the folder root. */
    cwd?: string,
  ): Promise<CompanySession> {
    const state = this.state();
    const request: SessionRequest = {
      role,
      workstreamId,
      requestedModel: this.profileFor(state, modelRoleOf(role, workstreamId)).requestedModel,
      requireLiveRunner: true,
    };
    let decision = this.pool.plan(request);
    if (
      decision.kind === 'queue' &&
      decision.code === 'live_limit' &&
      role === 'chat' &&
      (await this.parkOneIdleSession())
    ) {
      decision = this.pool.plan(request);
    }
    if (decision.kind === 'queue') {
      throw new CompanyError('company_pool_full', decision.detail);
    }
    if (decision.kind === 'reuse') {
      // An idle session whose process still runs is handed back as it is: reopening it would start a
      // second run for the same session, which the PTY host refuses ("Session already exists").
      if (decision.session.status !== 'parked' && this.hasLiveRun(decision.session)) {
        this.pool.upsert(decision.session);
        return decision.session;
      }
      await this.reopenSession(decision.session, decision.runEpoch);
      return { ...decision.session, runEpoch: decision.runEpoch, status: 'starting' };
    }
    for (const candidate of decision.archiveCandidates) await this.archiveSession(candidate);
    return this.mintSession(
      role,
      workstreamId,
      decision.mint.requestedModel,
      decision.runEpoch,
      cwd,
    );
  }

  private async mintSession(
    role: CompanyRole,
    workstreamId: string,
    requestedModel: string,
    runEpoch: number,
    cwd?: string,
  ): Promise<CompanySession> {
    const state = this.state();
    const counter = state.counters.session + 1;
    const session: CompanySession = {
      id: randomUUID(),
      code: `S${counter}`,
      name: `${ROLE_LABELS[role] ?? role} S${counter}`,
      role,
      workstreamId,
      workspaceKey: this.store.workspaceKey,
      ...(cwd === undefined ? {} : { cwd }),
      requestedModel,
      runEpoch,
      status: 'starting',
      lastUsedAt: this.deps.now(),
    };
    await this.commit(
      [
        { entity: 'session', op: 'put', id: session.id, value: session },
        {
          entity: 'counters',
          op: 'put',
          id: 'counters',
          value: { ...state.counters, session: counter },
        },
      ],
      this.state().revision,
    );
    this.pool.upsert(session);
    return session;
  }

  /** Bring a parked or idle session back for another run at a known epoch. */
  private async reopenSession(session: CompanySession, runEpoch: number): Promise<void> {
    this.handoffs.delete(session.id);
    const reopened: CompanySession = {
      ...session,
      runEpoch,
      status: 'starting',
      lastUsedAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'session', op: 'put', id: session.id, value: reopened }],
      this.state().revision,
    );
    this.pool.upsert(reopened);
  }

  /**
   * Open a plain omp chat session in this workspace. Nothing is sent: the session
   * starts with no turn and waits for the user's first prompt. `resumeFile`
   * reopens an omp session file instead of starting a fresh one. `cwd` is the
   * directory the process runs in (absent: the folder root). A non-chat `role`
   * opens a standalone session with no workflow, in its own squad workstream.
   */
  private async openChatSession(input: {
    resumeFile?: string;
    cwd?: string;
    role?: CompanyRole;
    workstreamKey?: string;
  }): Promise<CompanySession> {
    const role = input.role ?? 'chat';
    // A squad names its workstream, so the pool can resume a parked session for the same repo and role.
    const workstreamId =
      input.workstreamKey ?? (role === 'chat' ? `chat-${randomUUID()}` : `squad-${randomUUID()}`);
    const session = await this.acquireNewSession(role, workstreamId, input.cwd);
    if (!this.hasLiveRun(session)) await this.startRun(session, undefined, true, input.resumeFile);
    return this.state().sessions[session.id] ?? session;
  }

  /** Whether the session's current run epoch has a process the runtime still drives. */
  private hasLiveRun(session: CompanySession): boolean {
    return this.runs.get(session.id)?.runEpoch === session.runEpoch;
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────

  /**
   * Send one turn to a session, starting its process if it is not already live.
   *
   * Attachments become real content read from the stored artifact. An attachment
   * the native bridge cannot carry is refused here, before the process sees a
   * prompt: the bytes are never dropped and the run is never told the attachment
   * was seen.
   */
  private async dispatchTurn(
    sessionId: string,
    input: {
      text: string;
      delivery: OmpBridgeSendPrompt['delivery'];
      attachments: readonly PromptAttachment[];
    },
  ): Promise<void> {
    if (this.disposed) return;
    const session = this.state().sessions[sessionId];
    if (session === undefined) return;
    const images = await this.buildAttachmentPayload(input.attachments);
    const prompt: OmpBridgeSendPrompt = {
      requestId: randomUUID(),
      text: input.text,
      runEpoch: session.runEpoch,
      ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
      ...(images.length === 0 ? {} : { images }),
    };

    // The session is busy the MOMENT a turn starts, so it is marked busy before
    // the prompt is handed over. Sending first let the model call a role tool
    // that checks "is this session busy?" before the record said so, and the
    // Coordinator refused the very call it had just prompted for.
    await this.commit(
      [
        {
          entity: 'session',
          op: 'put',
          id: session.id,
          value: { ...session, status: 'busy', lastUsedAt: this.deps.now() },
        },
      ],
      this.state().revision,
    );

    const live = this.runs.get(session.id);
    if (live !== undefined && live.runEpoch === session.runEpoch) {
      live.busy = true;
      await live.runner.sendPrompt(session.runEpoch, prompt);
      return;
    }
    // The logical pool and the PTY helper can briefly disagree about capacity, so
    // a start refused for want of a PTY frees one safe idle session and tries
    // again for the SAME already-minted session. It must not mint a second one,
    // and any other failure is still a real failure.
    try {
      await this.startRun({ ...session, status: 'busy' }, prompt);
    } catch (error) {
      if (!(error instanceof CompanyError) || error.code !== 'pty_capacity_reached') throw error;
      if (!(await this.parkOneIdleSession())) throw error;
      await this.startRun({ ...session, status: 'busy' }, prompt);
    }
  }

  /** Read every image attachment out of the store, or refuse the whole prompt. */
  private async buildAttachmentPayload(
    attachments: readonly PromptAttachment[],
  ): Promise<BridgeImage[]> {
    const images: BridgeImage[] = [];
    for (const attachment of attachments) {
      const mimeType = attachment.mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
      if (IMAGE_MEDIA_TYPES[mimeType] !== true) {
        throw new CompanyError(
          'attachment_delivery_unsupported',
          `${attachment.fileName} is ${attachment.mediaType}, which the native runtime cannot receive as content. Nothing was sent.`,
        );
      }
      if (attachment.byteLength > COMPANY_ATTACHMENT_MAX_BYTES) {
        throw new CompanyError(
          'attachment_too_large',
          `${attachment.fileName} exceeds the ${COMPANY_ATTACHMENT_MAX_BYTES} byte attachment ceiling.`,
        );
      }
      const page = await this.store.readArtifact(attachment.artifactId, 0, ARTIFACT_PAGE_BYTES);
      if (!page.eof) {
        throw new CompanyError(
          'attachment_too_large',
          `${attachment.fileName} does not fit the delivery page limit.`,
        );
      }
      images.push({ mimeType, data: Buffer.from(page.dataBase64, 'base64').toString('base64') });
    }
    return images;
  }

  /**
   * Start one OMP process for a session and register it for lineage-checked
   * ownership. The pid comes from the PTY helper's own spawn reply, because the
   * host process has no other way to learn it.
   */
  private async startRun(
    session: CompanySession,
    firstTurn?: OmpBridgeSendPrompt,
    /**
     * False when the start is driven by `controlSession`, which runs inside the
     * coordinator's lock and may not write. The facts are returned to it instead,
     * which is the only channel a session record has.
     */
    persist = true,
    /** A session file to resume exactly; set only when the board reopens an omp session. */
    resumeFile?: string,
  ): Promise<ActiveRun> {
    const launch = await this.selectLaunchProfile(modelRoleOf(session.role, session.workstreamId));
    const profile = launch.profile;
    const runner = this.deps.createRunner({
      ptyClient: this.ptyClient,
      command: this.launch.command,
      extensionPath: this.launch.extensionPath,
      environment: process.env,
    });
    this.runCounter += 1;
    const run: ActiveRun = {
      sessionId: session.id,
      runId: `${session.id}:${session.runEpoch}:${this.runCounter}`,
      runEpoch: session.runEpoch,
      role: session.role,
      runner,
      profile,
      // A run started with no turn (the catalog probe) is not working on anything;
      // reporting it busy showed a second Director "at work" on every prompt.
      busy: firstTurn !== undefined,
      liveTools: new Map(),
      approvals: new Map(),
      effectiveModel: launch.effectiveModel,
      ...(session.nativeSessionId === undefined
        ? {}
        : { nativeSessionId: session.nativeSessionId }),
      stopping: false,
      unsubscribe: () => undefined,
    };
    run.unsubscribe = runner.onEvent((event) => this.onRunnerEvent(run, event));
    this.runs.set(session.id, run);

    try {
      await runner.start({
        sessionId: session.id,
        runEpoch: session.runEpoch,
        roleProfile: profile,
        // The process runs in the session's own directory. Approvals and tool
        // policy still answer for the folder root (see authorizeTool).
        workspaceRoot: session.cwd ?? this.store.workspacePath,
        ...(profile.toolsPolicy === 'omp'
          ? {}
          : { sessionDirectory: this.sessionDirectory(session.id) }),
        ...(resumeFile === undefined ? {} : { resumeFile }),
        // A work item's session runs in a terminal nobody watches: it must not stop on an approval.
        ...(isWorkItemSession(session) ? { unattended: true } : {}),
        ...(session.nativeSessionId === undefined
          ? {}
          : { nativeSessionId: session.nativeSessionId }),
        initialPrompt: firstTurn,
        rpcHandler: (request) => this.handleBridgeRpc(request),
      });
    } catch (error) {
      this.runs.delete(session.id);
      run.unsubscribe();
      await runner.dispose().catch(() => undefined);
      throw error;
    }
    const identity = runner.identity;
    if (identity === null) {
      await this.stopRun(run, 'the helper did not report the process it started');
      throw new CompanyError(
        'omp_process_identity_unknown',
        'The native process could not be identified, so it is not supervised.',
      );
    }
    this.supervisor.registerRun({
      runId: run.runId,
      sessionId: session.id,
      runEpoch: session.runEpoch,
      pid: identity.pid,
      imageName: identity.imageName,
      ports: {
        shutdownBridge: () => run.runner.dispose(),
        abort: (epoch) => run.runner.abort(epoch),
        closePty: () => this.ptyClient.kill(runnerPtySessionId(session.id, run.runEpoch)),
        isQuiescent: (epoch) => Promise.resolve(this.isQuiescent(run, epoch)),
      },
    });

    if (persist) {
      await this.recordRunIdentity(run);
      this.logEntry(run.sessionId, run.runEpoch, { kind: 'state', text: 'Phiên đã khởi động.' });
    }
    return run;
  }

  /**
   * Resolve the exact model string and thinking level a run launches with.
   *
   * An approved profile may spell its model as `provider/model:effort` while the
   * native catalog lists `provider/model` and advertises the effort separately,
   * so a suffix is honoured only when the base id IS in the live catalog AND
   * the suffix IS one of the efforts that model advertises. An id that matches a
   * catalog entry exactly — colon included — is used unchanged. Nothing is
   * guessed, and a suffix is never quietly dropped or lowered to the profile's
   * own `thinking`.
   */
  private async selectLaunchProfile(role: CompanyRole): Promise<LaunchProfile> {
    const approved = this.profileFor(this.state(), role);
    const unresolved: LaunchProfile = {
      profile: approved,
      effectiveModel: approved.requestedModel,
    };
    let catalog: CompanyModelCatalogEntry[];
    try {
      catalog = await this.modelCatalog();
    } catch {
      // The catalog could not be read: the CLI read failed and no live run can
      // answer. The approved spelling is passed through untouched, not resolved.
      return unresolved;
    }
    const exact = catalog.find((entry) => entry.id === approved.requestedModel);
    if (exact !== undefined) {
      return { profile: { ...approved, requestedModel: exact.id }, effectiveModel: exact.id };
    }
    const colon = approved.requestedModel.lastIndexOf(':');
    if (colon < 1) return unresolved;
    const baseId = approved.requestedModel.slice(0, colon);
    const suffix = approved.requestedModel.slice(colon + 1);
    const base = catalog.find((entry) => entry.id === baseId);
    if (base === undefined || !base.thinking.includes(suffix)) return unresolved;
    return {
      profile: { ...approved, requestedModel: base.id, thinking: suffix },
      effectiveModel: base.id,
    };
  }

  /** Persist what the native runtime told us about this run. */
  private async recordRunIdentity(run: ActiveRun): Promise<void> {
    const session = this.state().sessions[run.sessionId];
    if (session === undefined) return;
    await this.commit(
      [
        {
          entity: 'session',
          op: 'put',
          id: session.id,
          value: {
            ...session,
            ...(run.nativeSessionId === undefined ? {} : { nativeSessionId: run.nativeSessionId }),
            ...(run.effectiveModel === undefined ? {} : { effectiveModel: run.effectiveModel }),
            ...(run.nativeSessionPath === undefined
              ? {}
              : { nativeSessionPath: run.nativeSessionPath }),
            status: run.busy ? 'busy' : 'idle',
            lastUsedAt: this.deps.now(),
          },
        },
      ],
      this.state().revision,
    );
  }

  /**
   * Where OMP keeps a session's transcript: the company namespace, never the
   * workspace. Inside the workspace every role could list and read every other
   * role's transcript as if it were project code, and live runs spent minutes
   * doing exactly that instead of their task.
   */
  private sessionDirectory(sessionId: string): string {
    return path.join(this.store.namespaceDir, 'sessions', sessionId);
  }

  /** True only when the run is not mid-turn and no tool or child is still live. */
  private isQuiescent(run: ActiveRun, runEpoch: number): boolean {
    if (run.runEpoch !== runEpoch) return true;
    return !run.busy && run.liveTools.size === 0;
  }

  /**
   * Stop one run through the supervisor, and only through the supervisor.
   *
   * The supervisor verifies ownership BEFORE it closes the PTY or disposes the
   * bridge, because those ports are the only things that touch the process. This
   * method therefore never signals, never disposes the runner directly, and
   * never announces an exit it has not observed: `notifyExit` belongs to the real
   * PTY exit event alone. A run the supervisor cannot prove goes blocked, keeps
   * its bridge and terminal, and stays operator-visible.
   */
  private async stopRun(run: ActiveRun, reason: string): Promise<void> {
    if (run.stopping) return;
    run.stopping = true;
    this.sessionLog.flush(run.sessionId);
    this.releaseChildLeases(run);
    this.gateway.forgetRun(run.sessionId, run.runEpoch);
    let stopped = false;
    try {
      await this.supervisor.kill(run.runId, run.runEpoch);
      stopped = true;
    } catch (error) {
      // The supervisor refused: it could not prove ownership, so the process is
      // left exactly as it is and the run stays visible to the operator.
      this.handoffs.set(
        run.sessionId,
        `${reason} (ownership unproven; the process was left running)`,
      );
      void error;
      return;
    }
    this.runs.delete(run.sessionId);
    run.unsubscribe();
    if (stopped) this.handoffs.set(run.sessionId, reason);
  }

  /**
   * Erase a deleted session: stop its live process, then remove its OMP session
   * file (only where it resolves inside an omp or company sessions root), its
   * board log and its own directory. Runs inside the coordinator's lock and must
   * not commit. A stop the supervisor refuses leaves the session on the board.
   */
  private async deleteSession(
    sessionId: string,
    session: CompanySession | undefined,
  ): Promise<void> {
    if (!isSessionLogId(sessionId)) {
      throw new CompanyError('session_not_found', `Mã phiên không hợp lệ: ${sessionId}`);
    }
    const live = this.runs.get(sessionId);
    if (live !== undefined) {
      await this.stopRun(live, 'the session was deleted by the user');
      if (this.runs.has(sessionId)) {
        throw new CompanyError(
          'session_delete_refused',
          'Tiến trình OMP của phiên chưa dừng được nên phiên chưa bị xoá.',
        );
      }
    }
    this.handoffs.delete(sessionId);
    if (session?.nativeSessionPath !== undefined) {
      await removeSessionFileWithin(session.nativeSessionPath, [
        ompSessionsRoot(),
        path.join(this.store.namespaceDir, 'sessions'),
      ]);
    }
    await removeSessionLog(sessionLogDirectory(this.store.namespaceDir), sessionId);
    await fs.promises.rm(this.sessionDirectory(sessionId), { recursive: true, force: true });
    this.pool.remove(sessionId);
  }

  private async archiveSession(session: CompanySession): Promise<void> {
    const run = this.runs.get(session.id);
    if (run !== undefined) {
      await this.stopRun(run, 'the session was archived to free a pool slot');
    }
    const archived: CompanySession = {
      ...session,
      status: 'archived',
      lastUsedAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'session', op: 'put', id: session.id, value: archived }],
      this.state().revision,
    );
    this.pool.upsert(archived);
  }

  // ── Native events ────────────────────────────────────────────────────────

  private onRunnerEvent(
    run: ActiveRun,
    event: {
      kind: 'native' | 'terminal_data' | 'exit';
      data?: string;
      event?: unknown;
      exitCode?: number;
    },
  ): void {
    if (this.disposed) return;
    if (event.kind === 'terminal_data') {
      this.onMessage({
        type: 'terminalData',
        sessionId: run.sessionId,
        runEpoch: run.runEpoch,
        seq: this.gateway.nextSeq(run.sessionId, run.runEpoch),
        data: event.data ?? '',
      });
      return;
    }
    if (event.kind === 'exit') {
      // An exit is recorded from an event callback: nothing awaits it, so a
      // failed write must be reported here or it takes the whole server down.
      this.onRunExited(run, event.exitCode).catch((error: unknown) => {
        console.error(`[CompanyRuntime] could not record the exit of ${run.sessionId}.`, error);
      });
      return;
    }
    if (event.event !== null && typeof event.event === 'object') {
      this.onNativeEvent(run, event.event as Record<string, unknown>);
    }
  }

  private async onRunExited(run: ActiveRun, exitCode: number | undefined): Promise<void> {
    if (!this.runs.has(run.sessionId)) return;
    this.runs.delete(run.sessionId);
    run.unsubscribe();
    this.gateway.forgetRun(run.sessionId, run.runEpoch);
    this.sessionLog.flush(run.sessionId);
    this.supervisor.notifyExit(run.runId, {
      ...(exitCode === undefined ? {} : { exitCode }),
      expected: false,
    });
    // A run the board stopped on purpose (kill, archive, delete) exits while its
    // stopper is still writing the session's next state; recording "crashed"
    // over it raced that write, and for a delete it resurrected the session.
    if (run.stopping) {
      this.requestDispatch();
      return;
    }
    const session = this.state().sessions[run.sessionId];
    if (session !== undefined && !['archived', 'stopped'].includes(session.status)) {
      const crashed: CompanySession = {
        ...session,
        status: 'crashed',
        lastUsedAt: this.deps.now(),
      };
      delete crashed.insight;
      await this.commit(
        [
          {
            entity: 'session',
            op: 'put',
            id: session.id,
            value: crashed,
          },
        ],
        this.state().revision,
      );
      this.logEntry(session.id, run.runEpoch, {
        kind: 'state',
        text: exitCode === undefined ? 'Phiên đã sập.' : `Phiên đã sập (mã thoát ${exitCode}).`,
      });
    }
    // A crashed run's locks are NOT released: the workspace may still be
    // half-written, and another worker must not be handed the same files.
    this.requestDispatch();
  }

  private onNativeEvent(run: ActiveRun, event: Record<string, unknown>): void {
    const kind = event['k'];
    if (kind === 'session') {
      const nativeSessionId = readString(event, 'nativeSessionId');
      const nativeSessionPath = readString(event, 'nativeSessionPath');
      if (nativeSessionId !== undefined) run.nativeSessionId = nativeSessionId;
      if (nativeSessionPath !== undefined) run.nativeSessionPath = nativeSessionPath;
      void this.recordRunIdentity(run);
      return;
    }
    if (kind === 'text') {
      const text = readString(event, 'text');
      const seq = readNumber(event, 'seq');
      if (text === undefined || seq === undefined) return;
      const session = this.state().sessions[run.sessionId];
      this.onMessage({
        type: 'companyTextDelta',
        sessionId: run.sessionId,
        runEpoch: run.runEpoch,
        ...(session?.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
        seq,
        text,
      });
      this.sessionLog.text(
        run.sessionId,
        {
          runEpoch: run.runEpoch,
          ...(session?.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
        },
        text,
      );
      return;
    }
    if (kind === 'tool') {
      this.onToolEvent(run, event);
      return;
    }
    if (kind === 'usage') {
      this.onUsageEvent(run, event);
      return;
    }
    if (kind === 'insight') {
      this.onInsightEvent(run, event);
      return;
    }
    if (kind === 'quiescent') {
      this.sessionLog.flush(run.sessionId);
      if (event['idle'] === true) {
        // `run.busy` was set when the prompt was delivered and never cleared, so
        // the tool-quiescence path could never mark a session idle and no session
        // could ever be parked — capacity was never released, and a queued QA
        // dispatch had nothing to free a slot for.
        run.busy = false;
        void this.markRunIdle(run).catch((error: unknown) => {
          console.error('[Company] could not record an idle session.', error);
        });
      }
      return;
    }
    if (kind === 'error') {
      const code = readString(event, 'code') ?? 'omp_bridge_error';
      console.error(`[CompanyRuntime] OMP run ${run.sessionId} reported ${code}.`);
      this.logEntry(run.sessionId, run.runEpoch, {
        kind: 'error',
        text: `Cầu nối OMP báo lỗi: ${code}.`,
      });
    }
  }

  private onToolEvent(run: ActiveRun, event: Record<string, unknown>): void {
    const toolCallId = readString(event, 'toolCallId');
    if (toolCallId === undefined) return;
    if (event['phase'] === 'start') {
      const started = readString(event, 'toolName') ?? 'unknown';
      run.liveTools.set(toolCallId, started);
      // A `read` of a skill URL is logged under the skill's name, so skill use is
      // counted from the durable log like every other tool call.
      const declared = started === 'read' ? readString(event, 'skill') : undefined;
      const skill =
        declared !== undefined && declared.length <= SKILL_NAME_LOG_LIMIT ? declared : undefined;
      this.logEntry(run.sessionId, run.runEpoch, {
        kind: 'tool',
        toolName: started,
        text: skill === undefined ? started : `${SKILL_READ_LOG_PREFIX}${skill}`,
      });
      return;
    }
    const toolName = readString(event, 'toolName') ?? run.liveTools.get(toolCallId) ?? 'unknown';
    run.liveTools.delete(toolCallId);
    if (event['isError'] === true) {
      this.logEntry(run.sessionId, run.runEpoch, {
        kind: 'tool',
        toolName,
        text: toolName,
        ok: false,
      });
    }
    if (run.liveTools.size === 0 && !run.busy) {
      void this.markRunIdle(run).catch((error: unknown) => {
        console.error('[Company] could not record an idle session.', error);
      });
    }
  }

  private onUsageEvent(run: ActiveRun, event: Record<string, unknown>): void {
    const nativeSessionId = readString(event, 'nativeSessionId') ?? run.nativeSessionId;
    const nativeEntryId = readString(event, 'responseId');
    if (nativeSessionId === undefined || nativeEntryId === undefined) return;
    const session = this.state().sessions[run.sessionId];
    const totalTokens = readNumber(event, 'totalTokens');
    const costUsd = readNumber(event, 'costUsd');
    const contextTokens = readNumber(event, 'contextTokens');
    const recorded = this.usageLedger.record({
      sessionId: run.sessionId,
      nativeSessionId,
      nativeEntryId,
      role: session?.role ?? run.role,
      model: readString(event, 'model') ?? run.profile.requestedModel,
      provider: readString(event, 'provider') ?? 'unknown',
      purpose: 'model_usage',
      tokens: {
        input: readNumber(event, 'input') ?? 0,
        output: readNumber(event, 'output') ?? 0,
        cacheRead: readNumber(event, 'cacheRead') ?? 0,
        cacheWrite: readNumber(event, 'cacheWrite') ?? 0,
        ...(totalTokens === undefined ? {} : { totalTokens }),
      },
      ...(costUsd === undefined ? {} : { costUsd }),
      timestamp: this.deps.now(),
      source: 'provider',
      provenance: 'own_turn',
      runEpoch: run.runEpoch,
      ...(session?.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
    });
    if (recorded.duplicate) return;
    if (contextTokens !== undefined) {
      this.usageLedger.recordContext(run.sessionId, {
        contextTokens,
        providerReported: true,
        observedAt: this.deps.now(),
      });
    }
    this.enqueueUsageCommit(run.sessionId, recorded.entry.record);
  }

  /**
   * Usage writes, one at a time per session.
   *
   * Usage arrives as a burst of fire-and-forget events, and each one committed
   * the same `usage` entity concurrently: two writes raced, the loser threw
   * `company_revision_conflict` with no catcher, and the rejected promise took the
   * whole host process down. Chaining them keeps event order, reads the revision
   * when the write actually runs, and reports rather than rejects.
   */
  private readonly usageCommits = new Map<string, Promise<void>>();

  private enqueueUsageCommit(sessionId: string, entry: UsageRecord): void {
    const previous = this.usageCommits.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.commit(
          [{ entity: 'usage', op: 'put', id: sessionId, value: entry }],
          this.state().revision,
        );
      })
      .catch((error: unknown) => {
        console.error('[Company] could not persist a usage record.', error);
      })
      .finally(() => {
        if (this.usageCommits.get(sessionId) === next) this.usageCommits.delete(sessionId);
      });
    this.usageCommits.set(sessionId, next);
  }

  /** Insight commits per session, chained so each one re-reads the latest state. */
  private readonly insightCommits = new Map<string, Promise<void>>();

  private onInsightEvent(run: ActiveRun, event: Record<string, unknown>): void {
    const insight = parseSessionInsight(event, this.deps.now());
    if (insight === undefined) return;
    this.enqueueInsightCommit(run.sessionId, run.runEpoch, insight);
  }

  private enqueueInsightCommit(
    sessionId: string,
    runEpoch: number,
    insight: CompanySessionInsight,
  ): void {
    const previous = this.insightCommits.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const session = this.state().sessions[sessionId];
        if (session === undefined || session.runEpoch !== runEpoch) return;
        // `observedAt` moves on every push, so compare the content alone.
        const unchanged =
          session.insight !== undefined &&
          JSON.stringify({ ...session.insight, observedAt: '' }) ===
            JSON.stringify({ ...insight, observedAt: '' });
        if (unchanged) return;
        await this.commit(
          [{ entity: 'session', op: 'put', id: sessionId, value: { ...session, insight } }],
          this.state().revision,
        );
      })
      .catch((error: unknown) => {
        console.error('[Company] could not persist a session insight.', error);
      })
      .finally(() => {
        if (this.insightCommits.get(sessionId) === next) this.insightCommits.delete(sessionId);
      });
    this.insightCommits.set(sessionId, next);
  }

  /** The identity a native child is deduped and leased by. */
  private childLeaseKey(
    run: ActiveRun,
    spawnKey: string | undefined,
    invocationKind: string,
    agent: string,
  ): string {
    return spawnKey ?? `${run.sessionId}@${run.runEpoch}:${invocationKind}:${agent}`;
  }

  /** Release every child lease a run holds; called only on quiescence or teardown. */
  private releaseChildLeases(run: ActiveRun): void {
    for (const [key, lease] of [...this.childLeases]) {
      if (lease.sessionId === run.sessionId && lease.runEpoch === run.runEpoch) {
        this.childLeases.delete(key);
      }
    }
  }

  /**
   * One idle transition per session at a time.
   *
   * Quiescence and tool-end can both fire for the same turn, and two concurrent
   * transitions each write the whole session row: one commits and the other
   * conflicts, and its stale put can land on top of a question answer committed
   * in between. Callers share one promise instead.
   */
  private readonly idleTransitions = new Map<string, Promise<void>>();

  private markRunIdle(run: ActiveRun): Promise<void> {
    const existing = this.idleTransitions.get(run.sessionId);
    if (existing !== undefined) return existing;
    const transition = this.recordRunIdle(run).finally(() => {
      if (this.idleTransitions.get(run.sessionId) === transition) {
        this.idleTransitions.delete(run.sessionId);
      }
    });
    this.idleTransitions.set(run.sessionId, transition);
    return transition;
  }

  private async recordRunIdle(run: ActiveRun): Promise<void> {
    if (run.busy || run.liveTools.size > 0) return;
    const state = this.state();
    const session = state.sessions[run.sessionId];
    if (session === undefined || session.status !== 'busy') return;
    const contract = this.contractForSession(state, session);
    const handoff = buildSessionHandoff({
      session,
      ...(contract === undefined ? {} : { contract }),
      tasks: Object.values(state.tasks).filter((task) => task.sessionId === session.id),
      decisions: contract?.decisions ?? [],
      evidence: Object.values(state.evidence),
      attempts: Object.values(state.attempts).filter((attempt) => attempt.sessionId === session.id),
      nextAction:
        session.activeTaskId === undefined
          ? 'Await the next instruction.'
          : 'Continue the assigned task.',
      generatedAt: this.deps.now(),
    });
    const text = renderHandoffText(handoff);
    const artifactId = await this.store.writeArtifact(
      Buffer.from(text, 'utf8'),
      'application/json',
    );
    // Writing the handoff artifact awaited, and the session can move on while it
    // does — a question answered in that window restarts the turn. Committing the
    // row captured before the await would revert it, so the live row is re-read
    // and an idle marker is dropped entirely if the session is busy again.
    const current = this.state().sessions[session.id];
    if (current === undefined || current.status !== 'busy') return;
    // A restarted turn is `busy` again, so status alone cannot tell "still
    // finishing" from "already given a new prompt". The epoch and the timestamp
    // the row carried when this transition began must both still hold.
    if (run.busy || run.liveTools.size > 0) return;
    if (current.runEpoch !== run.runEpoch || current.lastUsedAt !== session.lastUsedAt) return;
    const idle: CompanySession = {
      ...current,
      status: 'idle',
      handoffArtifactId: artifactId,
      lastUsedAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'session', op: 'put', id: session.id, value: idle }],
      this.state().revision,
    );
    this.pool.upsert(idle);
    this.logEntry(session.id, run.runEpoch, {
      kind: 'state',
      text: 'Phiên đang rảnh, chờ chỉ thị tiếp theo.',
    });
    this.handoffs.set(session.id, text);
    // Work is finished only now that the tools are quiet, so the lock and the
    // capacity lease are handed back here and not when the result arrived. The
    // LIVE row's assignment is released, not the one captured before the artifact
    // write awaited — releasing a stale id released a task this session no longer
    // had, which let the dispatcher start it again.
    if (current.activeTaskId !== undefined) this.scheduler.release(current.activeTaskId);
    this.requestDispatch();
    await this.drainPendingReviewerDispatches();
  }

  /**
   * Reviewer dispatches waiting for a runner slot.
   *
   * A finished Worker does not free its process immediately, so a QA or Judge
   * dispatch can find every live slot taken by sessions that have nothing left to
   * do. Dropping it silently ended the chain with the task stuck, so the request
   * is kept here and retried whenever a session goes idle or is parked.
   */
  private readonly pendingReviewerDispatches: {
    role: ReviewerRole;
    taskId: string;
    attemptId: string;
  }[] = [];

  private async drainPendingReviewerDispatches(): Promise<void> {
    while (this.pendingReviewerDispatches.length > 0) {
      const pending = this.pendingReviewerDispatches[0];
      const sent =
        pending.role === 'judge'
          ? await this.dispatchJudgeForTask(pending.taskId, pending.attemptId)
          : await this.dispatchQaForTask(pending.taskId, pending.attemptId);
      if (sent) {
        this.pendingReviewerDispatches.shift();
        continue;
      }
      // Every slot is taken by a session that is idle but still holding a
      // process, so the ordinary sweep — which waits out the idle window — would
      // not free one in time. Park one genuinely safe idle session now and try
      // again: its context is already in a durable handoff, so nothing is lost.
      if (!(await this.parkOneIdleSession())) return;
    }
  }

  /**
   * Park one idle session that has nothing outstanding.
   *
   * Safe means the same things the idle sweep requires — no busy turn, no live
   * tool, no assigned task, no pending question and no attached terminal — minus
   * the idle-duration wait, which exists to avoid churn rather than to protect
   * anything. A durable handoff already carries the context.
   */
  private async parkOneIdleSession(): Promise<boolean> {
    const state = this.state();
    const pendingQuestions = new Set(
      Object.values(state.questions)
        .filter((question) => question.status === 'pending')
        .map((question) => question.sessionId),
    );
    for (const session of Object.values(state.sessions)) {
      if (session.status !== 'idle' || session.activeTaskId !== undefined) continue;
      if (pendingQuestions.has(session.id)) continue;
      const run = this.runs.get(session.id);
      if (run === undefined || run.busy || run.liveTools.size > 0) continue;
      if (this.gateway.hasViewer(session.id, run.runEpoch)) continue;
      await this.stopRun(run, 'the session was idle and its slot was needed');
      const parked: CompanySession = {
        ...session,
        status: 'parked',
        lastUsedAt: this.deps.now(),
      };
      await this.commit(
        [{ entity: 'session', op: 'put', id: session.id, value: parked }],
        this.state().revision,
      );
      this.pool.upsert(parked);
      this.logEntry(session.id, session.runEpoch, {
        kind: 'state',
        text: 'Phiên đã đậu để nhường chỗ cho phiên khác.',
      });
      return true;
    }
    return false;
  }

  // ── Scheduling ───────────────────────────────────────────────────────────

  private onStateChanged(event: CompanyEvent): void {
    this.onMessage({
      type: 'companyStateChanged',
      revision: event.sequence,
      changes: event.changes,
    });
    this.requestDispatch();
  }

  private requestDispatch(): void {
    if (this.disposed || this.dispatching) {
      this.dispatchPending = true;
      return;
    }
    this.dispatching = true;
    void this.drainDispatch()
      .catch((error) => {
        console.error('[CompanyRuntime] Dispatch pass failed.', error);
      })
      .finally(() => {
        this.dispatching = false;
        if (this.dispatchPending) {
          this.dispatchPending = false;
          this.requestDispatch();
        }
      });
  }

  private async drainDispatch(): Promise<void> {
    await this.seedVerificationProfiles();
    if (this.pendingRecovery.length > 0) {
      const pending = this.pendingRecovery;
      this.pendingRecovery = [];
      await this.commit(pending, this.state().revision);
    }
    const state = this.state();
    for (const contract of Object.values(state.contracts)) {
      if (contract.status !== 'approved' && contract.status !== 'running') continue;
      // The Contract EMBEDS its tasks, and that copy is left at the status the
      // Contract was approved with. Planning from it re-dispatched a task that
      // `state.tasks` already had as `verifying`, which started a second Worker
      // attempt for work already in review. The canonical task entity is the
      // authority for status; the embedded copy supplies the shape.
      const liveContract: Contract = {
        ...contract,
        tasks: contract.tasks.map((task) => state.tasks[task.id] ?? task),
      };
      const plan = this.scheduler.plan({
        contract: liveContract,
        sessions: Object.values(state.sessions),
      });
      for (const entry of plan.dispatch) await this.startTaskAttempt(entry.taskId);
    }
  }

  private async startTaskAttempt(taskId: string): Promise<void> {
    const task = this.state().tasks[taskId];
    if (task === undefined) return;
    const session = await this.acquireWorkerSession(task);
    if (session === undefined) return;
    const attempt: Attempt = {
      id: randomUUID(),
      taskId: task.id,
      sessionId: session.id,
      runEpoch: session.runEpoch,
      startedAt: this.deps.now(),
      status: 'running',
      changes: [],
      evidenceIds: [],
    };
    await this.commit(
      [
        {
          entity: 'task',
          op: 'put',
          id: task.id,
          value: {
            ...task,
            sessionId: session.id,
            status: 'running',
            attemptIds: [...task.attemptIds, attempt.id],
            routeReason: `đã được phân phối tới ${session.code}`,
          },
        },
        { entity: 'attempt', op: 'put', id: attempt.id, value: attempt },
        {
          entity: 'session',
          op: 'put',
          id: session.id,
          value: { ...session, activeTaskId: task.id, status: 'busy', lastUsedAt: this.deps.now() },
        },
      ],
      this.state().revision,
    );
    const assigned = this.state().sessions[session.id];
    if (assigned === undefined) return;
    await this.dispatchTurn(assigned.id, {
      // The tool call needs both UUIDs, so the instruction names both. A role
      // told only the display code could not correlate the very result the
      // runtime is waiting for.
      text: this.composePromptText(
        assigned,
        `Implement task ${task.code} (task id ${task.id}, attempt id ${attempt.id}): ${task.title}.` +
          ` Report the outcome with company_task_result.`,
      ),
      delivery: 'prompt',
      attachments: [],
    });
  }

  private async acquireWorkerSession(task: Task): Promise<CompanySession | undefined> {
    const state = this.state();
    const pinned = task.sessionId === undefined ? undefined : state.sessions[task.sessionId];
    if (pinned !== undefined && pinned.status !== 'archived') {
      this.pool.upsert(pinned);
      return pinned;
    }
    const decision = this.pool.plan({
      role: 'worker',
      workstreamId: task.workstreamId,
      requestedModel: this.profileFor(state, 'worker').requestedModel,
      requireLiveRunner: true,
    });
    if (decision.kind === 'queue') {
      // Capacity is a real refusal, not a silent drop: the lock and the lease go
      // straight back so the task keeps its place in the queue.
      this.scheduler.release(task.id);
      return undefined;
    }
    if (decision.kind === 'reuse') {
      await this.reopenSession(decision.session, decision.runEpoch);
      return { ...decision.session, runEpoch: decision.runEpoch, status: 'starting' };
    }
    for (const candidate of decision.archiveCandidates) await this.archiveSession(candidate);
    return this.mintSession(
      'worker',
      task.workstreamId,
      decision.mint.requestedModel,
      decision.runEpoch,
    );
  }

  // ── Contract decisions, reviews and questions ────────────────────────────

  private async onContractDecision(contract: Contract, decision: ContractDecision): Promise<void> {
    if (decision !== 'approve') return;
    // Approval is what releases work, so it schedules. Re-running the
    // architecture review here was wrong twice over: the review had already
    // moved the draft to `awaiting_approval`, and every other transition in this
    // runtime ends by asking the scheduler to look again. Without that, approval
    // produced a second review and no Worker — the board simply sat empty.
    void contract;
    this.requestDispatch();
  }

  /**
   * Send one reviewer its Contract.
   *
   * The Contract's identity is composed HERE rather than by each caller,
   * because every reviewer tool (`company_architecture_review`, `company_report`)
   * takes a contractId. A caller that named only the display code left the
   * reviewer unable to address the Contract it was asked to judge.
   */
  private async dispatchReviewer(
    role: ReviewerRole,
    contract: Contract,
    instruction: string,
  ): Promise<void> {
    const session = await this.acquireReviewerSession(role, this.workstreamOf(contract));
    if (session === undefined) return;
    // The Advisor reviews a draft that exists only in company state, not in the
    // workspace, so the draft itself travels with the instruction. Seen live: an
    // Advisor told only the id asked the user for the Contract it was reviewing.
    const draft =
      role === 'advisor'
        ? `\n\nThe draft under review:\n${JSON.stringify({
            title: contract.title,
            summary: contract.summary,
            requirements: contract.requirements,
            phases: contract.phases,
            tasks: contract.tasks.map(
              ({ status: _status, attemptIds: _attempts, ...task }) => task,
            ),
            acceptance: contract.acceptance,
            assumptions: contract.assumptions,
            decisions: contract.decisions,
            risks: contract.risks,
          })}`
        : '';
    await this.dispatchTurn(session.id, {
      text: this.composePromptText(
        session,
        `Contract ${contract.code}, id ${contract.id}, revision ${contract.revision}. ${instruction}${draft}`,
      ),
      delivery: 'prompt',
      attachments: [],
    });
  }

  private async acquireReviewerSession(
    role: ReviewerRole,
    workstreamId: string,
  ): Promise<CompanySession | undefined> {
    const state = this.state();
    const decision = this.pool.plan({
      role,
      workstreamId,
      requestedModel: this.profileFor(state, role).requestedModel,
      requireLiveRunner: true,
    });
    if (decision.kind === 'queue') return undefined;
    if (decision.kind === 'reuse') {
      await this.reopenSession(decision.session, decision.runEpoch);
      return { ...decision.session, runEpoch: decision.runEpoch, status: 'starting' };
    }
    for (const candidate of decision.archiveCandidates) await this.archiveSession(candidate);
    return this.mintSession(role, workstreamId, decision.mint.requestedModel, decision.runEpoch);
  }

  private async onQuestionAnswered(question: Question, input: QuestionAnswerInput): Promise<void> {
    const run = this.runs.get(question.sessionId);
    if (run === undefined || run.runEpoch !== question.runEpoch) return;
    this.logEntry(question.sessionId, run.runEpoch, {
      kind: 'question',
      text: 'Người dùng đã trả lời câu hỏi.',
    });
    if (question.actionDigest !== undefined && run.approvals.delete(question.actionDigest)) {
      // An answered approval releases exactly the call it was bound to; nothing
      // else the session asked for becomes permitted.
      return;
    }
    if (question.kind === 'clarification' && question.nativeToolCallId !== undefined) {
      // The native ask is still waiting in the terminal. A terminal answer already reached the
      // model; a board answer closes that same dialog with the user's choices. Neither becomes
      // a second turn the model would read on top of its own tool result.
      if (this.terminalAnswers.has(question.id)) return;
      const answers = nativeAnswers(this.state().questions[question.id] ?? question, input.answers);
      try {
        await run.runner.answerQuestion(run.runEpoch, { questionId: question.id, answers });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logEntry(question.sessionId, run.runEpoch, {
          kind: 'question',
          text: `Không chuyển được câu trả lời vào phiên: ${reason}`,
        });
      }
      return;
    }
    const answered = this.state().questions[question.id];
    const text = Object.entries(input.answers)
      .map(([promptId, answer]) => {
        const options =
          answered?.questions.find((entry) => entry.id === promptId)?.options ??
          ([] as QuestionOption[]);
        const labels = answer.selectedIndices
          .map((index) => options[index]?.label)
          .filter((label): label is string => label !== undefined);
        const chosen = labels.length > 0 ? labels.join(', ') : 'no option selected';
        return `${promptId}: ${chosen}${answer.text === undefined ? '' : ` — ${answer.text}`}`;
      })
      .join('\n');
    await this.dispatchTurn(question.sessionId, {
      text: `The user answered ${question.title}:\n${text}`,
      delivery: 'follow_up',
      attachments: [],
    });
  }

  // ── Session control ──────────────────────────────────────────────────────

  private async controlSession(
    session: CompanySession,
    action: CompanySessionAction,
    runEpoch: number,
  ): Promise<CompanySessionControlResult> {
    if (action === 'archive') {
      // Inside the coordinator's lock: this must not write. The `archived` status
      // is committed by the coordinator once this effect returns it.
      const live = this.runs.get(session.id);
      if (live !== undefined) {
        await this.stopRun(live, 'the session was archived to free a pool slot');
      }
      this.logEntry(session.id, session.runEpoch, {
        kind: 'state',
        text: 'Phiên đã được lưu trữ.',
      });
      return { status: 'archived' };
    }
    const run = this.runs.get(session.id);
    if (
      run === undefined &&
      session.role === 'chat' &&
      (action === 'resume' || action === 'restart')
    ) {
      return this.reopenChatSession(session);
    }
    if (run === undefined || run.runEpoch !== runEpoch) {
      // No live process to act on: the truthful answer is the record's own
      // status, not a fabricated success.
      return { status: session.status };
    }

    if (action === 'interrupt') {
      // Esc in omp: the native turn ends and the run-end path returns the session to idle.
      await run.runner.abort(runEpoch);
      this.logEntry(session.id, runEpoch, {
        kind: 'state',
        text: 'Lượt đang chạy đã được dừng theo yêu cầu của người dùng.',
      });
      return { status: session.status };
    }

    if (action === 'pause') {
      const record = await this.supervisor.pause(run.runId, runEpoch);
      const paused = record.state === 'paused';
      this.logEntry(session.id, runEpoch, {
        kind: 'state',
        text: paused ? 'Phiên đã tạm dừng.' : 'Phiên đang tạm dừng.',
      });
      return { status: paused ? 'paused' : 'pausing' };
    }
    if (action === 'kill') {
      await this.stopRun(run, 'the session was stopped by the user');
      this.logEntry(session.id, runEpoch, {
        kind: 'state',
        text: 'Phiên đã dừng theo yêu cầu của người dùng.',
      });
      return { status: 'stopped' };
    }
    if (action === 'resume') {
      const resumed = await this.startRun(
        session,
        { requestId: randomUUID(), text: 'You were paused. Wait for the next instruction.' },
        false,
      );
      this.logEntry(session.id, runEpoch, { kind: 'state', text: 'Phiên đã tiếp tục.' });
      return this.startResult(resumed);
    }
    if (action === 'restart') {
      await this.stopRun(run, 'the session was restarted by the user');
      const fresh = this.state().sessions[session.id];
      if (fresh === undefined) return { status: 'stopped' };
      const restarted = await this.startRun(
        {
          ...fresh,
          runEpoch: runEpoch + 1,
          ...(run.nativeSessionId === undefined ? {} : { nativeSessionId: run.nativeSessionId }),
        },
        { requestId: randomUUID(), text: 'You were restarted. Wait for the next instruction.' },
        false,
      );
      this.logEntry(session.id, runEpoch + 1, {
        kind: 'state',
        text: 'Phiên đã được khởi động lại.',
      });
      return this.startResult(restarted);
    }
    return { status: session.status };
  }

  /**
   * Start a parked, stopped or crashed chat session again on the omp file its record
   * holds, under the same session record. Runs inside the coordinator's lock, so it
   * persists nothing: the coordinator commits the status from the returned result.
   */
  private async reopenChatSession(session: CompanySession): Promise<CompanySessionControlResult> {
    if (session.nativeSessionPath === undefined) {
      throw new CompanyError('session_reopen_refused', CHAT_REOPEN_WITHOUT_FILE_MESSAGE);
    }
    const reopened = await this.startRun(session, undefined, false, session.nativeSessionPath);
    this.pool.upsert({ ...session, status: 'starting' });
    this.logEntry(session.id, session.runEpoch, {
      kind: 'state',
      text: 'Phiên đã được mở lại từ file phiên OMP đã lưu.',
    });
    return this.startResult(reopened);
  }

  /**
   * Prove this runtime still owns the live process before a destructive control.
   *
   * Refusal is inert: nothing is killed, closed or released here, so the run keeps
   * its bridge and PTY and stays visible to the operator. What is proven is RUNTIME
   * ownership — the run is registered at exactly this epoch, the runner is still
   * running, and it still reports the pid the helper gave us at spawn. OS-level
   * lineage is the supervisor's job and is enforced again on the kill itself.
   */
  verifyControlOwnership = async (
    session: CompanySession,
    action: CompanySessionAction,
    runEpoch: number,
  ): Promise<void> => {
    const run = this.runs.get(session.id);
    if (run === undefined) return; // No live process: there is nothing to prove.
    if (run.runEpoch !== runEpoch) {
      throw new CompanyOwnershipError(
        'gone',
        `Session ${session.code} is at epoch ${run.runEpoch}, not ${runEpoch}.`,
      );
    }
    if (run.runner.state !== 'running') {
      throw new CompanyOwnershipError(
        'unproven',
        `The native process for ${session.code} is ${run.runner.state}; ${action} was refused.`,
      );
    }
    let verdict: OwnershipVerdict;
    try {
      verdict = await this.supervisor.verifyRunOwnership(run.runId, runEpoch);
    } catch (error) {
      // An unknown or unreadable run is NOT an owned run, so it fails closed.
      throw new CompanyOwnershipError(
        'gone',
        `The supervisor cannot prove the run for ${session.code} epoch ${runEpoch}; ${action} was refused.`,
        { cause: error },
      );
    }

    // 'owned' proves the process is ours; 'gone' means nothing live is left to
    // prove, which is the same situation as a session with no run at all.
    // 'conflict' and 'unproven' refuse, and must never reach a mutation.
    if (verdict !== 'owned' && verdict !== 'gone') {
      throw new CompanyOwnershipError(
        verdict === 'conflict' ? 'conflict' : 'unproven',
        `The supervisor cannot prove ${session.code} epoch ${runEpoch} is still ours (${verdict}); ${action} was refused.`,
      );
    }
    if (this.supervisor.getRun(run.runId) === undefined) {
      throw new CompanyOwnershipError(
        'unproven',
        `The run for ${session.code} is no longer registered with the supervisor.`,
      );
    }
    const identity = run.runner.identity;
    if (identity === null) {
      throw new CompanyOwnershipError(
        'unproven',
        `The native process for ${session.code} no longer reports the identity it started with.`,
      );
    }
  };

  private startResult(run: ActiveRun): CompanySessionControlResult {
    return {
      status: 'starting',
      ...(run.nativeSessionId === undefined ? {} : { nativeSessionId: run.nativeSessionId }),
      ...(run.nativeSessionPath === undefined ? {} : { nativeSessionPath: run.nativeSessionPath }),
      effectiveModel: run.profile.requestedModel,
    };
  }

  private async onSettingsUpdated(profiles: Record<string, RoleProfile>): Promise<void> {
    for (const run of this.runs.values()) {
      // A squad chat session runs on its key's role, so that role's profile is the one it follows.
      const workstreamId = this.state().sessions[run.sessionId]?.workstreamId ?? '';
      const next = profiles[modelRoleOf(run.role, workstreamId)];
      // A live run keeps the profile it started with: switching models between
      // tool calls is exactly what the settings contract forbids.
      if (next === undefined || next.requestedModel !== run.profile.requestedModel) continue;
      run.profile = next;
    }
    this.requestDispatch();
  }

  // ── Bridge gates ─────────────────────────────────────────────────────────

  private async handleBridgeRpc(request: OmpBridgeRpcRequest): Promise<unknown> {
    const run = this.runs.get(request.sessionId);
    if (run === undefined || run.runEpoch !== request.runEpoch) {
      throw new OmpBridgeRpcError(
        'stale_company_run_epoch',
        'The bridge frame belongs to a run this runtime does not own.',
      );
    }
    if (request.method === 'authorize_tool') return this.authorizeTool(run, request);
    if (request.method === 'authorize_subagent') return this.authorizeSubagent(run, request);
    if (request.method === 'publish_question') return this.publishNativeQuestion(run, request);
    if (request.method === 'answer_question') return this.answerNativeQuestion(run, request);
    if (request.method === 'cancel_question') return this.cancelNativeQuestion(run, request);
    const method: string = request.method;
    if (method === 'company_tool') return this.handleCompanyTool(run, request);
    // A frame the type cannot name still arrives as raw JSON, so the refusal is
    // kept on a widened string rather than trusted away by exhaustiveness.
    throw new OmpBridgeRpcError('company_rpc_unknown', `${method} is not a Company method.`);
  }

  /**
   * Persist a native Ask dialog as the one durable Question both surfaces share.
   *
   * The record is written BEFORE the dialog is acknowledged, so an answer can
   * never arrive for a question that does not exist.
   */
  private async publishNativeQuestion(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'publish_question' }>,
  ): Promise<{ questionId: string }> {
    const session = this.state().sessions[run.sessionId];
    const id = randomUUID();
    const question: Question = {
      id,
      sessionId: run.sessionId,
      ...(session?.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
      runEpoch: run.runEpoch,
      nativeToolCallId: request.toolCallId,
      kind: 'clarification',
      title: request.questions[0]?.question ?? 'The native session needs an answer.',
      questions: request.questions.map((entry) => ({
        id: entry.id,
        question: entry.question,
        options: entry.options.map((option) => option),
        ...(entry.multi === true ? { multi: true } : {}),
        ...(entry.recommended === undefined ? {} : { recommended: entry.recommended }),
      })),
      status: 'pending',
      createdAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'question', op: 'put', id, value: question }],
      this.state().revision,
    );
    this.logEntry(run.sessionId, run.runEpoch, {
      kind: 'question',
      text: `Hỏi người dùng: ${question.title}`,
    });
    return { questionId: id };
  }

  /**
   * Settle the race between a board answer and a terminal answer.
   *
   * Whoever writes first wins; the loser is told what the stored answer actually
   * is, so the model acts on the real decision instead of an empty one. The
   * winner is applied through the coordinator, which owns Question answers.
   */
  private async answerNativeQuestion(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'answer_question' }>,
  ): Promise<{ status: 'recorded' } | { status: 'already_resolved'; answers: OmpBridgeQuestionAnswer[] }> {
    const question = this.state().questions[request.questionId];
    if (
      question !== undefined &&
      (question.sessionId !== run.sessionId || question.runEpoch !== run.runEpoch)
    ) {
      throw new OmpBridgeRpcError(
        'stale_company_run_epoch',
        'That question belongs to a run this runtime no longer owns.',
      );
    }
    if (question === undefined) {
      throw new OmpBridgeRpcError('question_not_found', `Unknown question: ${request.questionId}`);
    }
    if (question.status !== 'pending') {
      // The board won: its answer goes back in the native tool's own shape, question by question.
      return { status: 'already_resolved', answers: nativeAnswers(question, recordedAnswers(question)) };
    }
    this.terminalAnswers.add(question.id);
    try {
      await this.coordinator().answerQuestion({
        requestId: request.id,
        questionId: request.questionId,
        runEpoch: request.runEpoch,
        ...(question.actionDigest === undefined ? {} : { actionDigest: question.actionDigest }),
        answers: {
          [question.questions[0]?.id ?? 'answer']: {
            selectedIndices: request.answer.selectedOptions.map((label) =>
              Math.max(
                0,
                (question.questions[0]?.options ?? []).findIndex((option) => option.label === label),
              ),
            ),
            ...(request.answer.customInput === undefined ? {} : { text: request.answer.customInput }),
            isOther: request.answer.customInput !== undefined,
          },
        },
      });
    } finally {
      this.terminalAnswers.delete(question.id);
    }
    return { status: 'recorded' };
  }

  /** Withdraw a dialog that produced no answer; a withdrawal is never a yes. */
  private async cancelNativeQuestion(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'cancel_question' }>,
  ): Promise<{ cancelled: true }> {
    const question = this.state().questions[request.questionId];
    if (
      question !== undefined &&
      (question.sessionId !== run.sessionId || question.runEpoch !== run.runEpoch)
    ) {
      throw new OmpBridgeRpcError(
        'stale_company_run_epoch',
        'That question belongs to a run this runtime no longer owns.',
      );
    }
    if (question !== undefined && question.status === 'pending') {
      await this.commit(
        [
          {
            entity: 'question',
            op: 'put',
            id: question.id,
            value: { ...question, status: 'cancelled', resolvedAt: this.deps.now() },
          },
        ],
        this.state().revision,
      );
    }
    return { cancelled: true };
  }

  private authorizeTool(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'authorize_tool' }>,
  ): OmpBridgeToolAuthorization {
    const state = this.state();
    const session = state.sessions[run.sessionId];
    if (session === undefined) {
      throw new OmpBridgeRpcError('company_session_unknown', 'This run has no session record.');
    }
    const task = session.activeTaskId === undefined ? undefined : state.tasks[session.activeTaskId];
    // A native child is not the session main agent, so it never inherits the
    // session's write scopes: it is answered as a read-only role with none.
    const fromChild = request.agentKind !== undefined && request.agentKind !== 'main';
    const decision = decideToolCall({
      role: fromChild ? 'judge' : session.role,
      tool: request.toolName,
      args: request.input,
      workspaceRoot: session.cwd ?? this.store.workspacePath,
      writeScopes: fromChild ? [] : (task?.writeScopes ?? []),
      approvedCommands: fromChild ? [] : this.approvedCommandsFor(task),
    });
    if (decision.allowed) return { allow: true, reason: decision.reason };
    if (!decision.requiresApproval) return { allow: false, reason: decision.reason };
    return { allow: false, reason: this.raiseApproval(run, request, decision.reason) };
  }

  private approvedCommandsFor(task: Task | undefined): ApprovedVerificationCommand[] {
    if (task === undefined) return [];
    const state = this.state();
    const commands: ApprovedVerificationCommand[] = [];
    for (const commandIds of approvedCommandsByCriterion(state, task).values()) {
      for (const commandId of commandIds) {
        const approved = approvedVerificationCommand(state, task, commandId);
        if (approved === null) continue;
        commands.push({
          id: approved.command.id,
          executable: approved.command.executable,
          argv: [...approved.command.argv],
          cwd: approved.command.cwd,
        });
      }
    }
    return commands;
  }

  /**
   * Persist the approval question and bind it to the exact call.
   *
   * The digest covers the tool, its arguments, the task, the session and the
   * run epoch, so an answer can only ever release the action the user was
   * actually shown. Nothing is auto-approved: an unanswered question leaves the
   * call refused.
   */
  private raiseApproval(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'authorize_tool' }>,
    reason: string,
  ): string {
    const state = this.state();
    const session = state.sessions[run.sessionId];
    if (session === undefined) {
      throw new OmpBridgeRpcError('company_session_unknown', 'This run has no session record.');
    }
    const digest = actionDigest({
      sessionId: run.sessionId,
      taskId: session.activeTaskId ?? 'none',
      runEpoch: run.runEpoch,
      toolCallId: request.toolCallId,
      tool: request.toolName,
      args: request.input,
    });
    if (run.approvals.has(digest)) return `Waiting for the user to answer: ${reason}`;
    const questionId = approvalQuestionId(digest);
    const question: Question = {
      id: questionId,
      sessionId: run.sessionId,
      ...(session.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
      runEpoch: run.runEpoch,
      nativeToolCallId: request.toolCallId,
      kind: 'approval',
      title: `Duyệt ${request.toolName}`,
      questions: [
        {
          id: 'approve',
          question: reason,
          options: [
            {
              label: 'Duyệt một lần',
              description: 'Cho phép đúng lệnh gọi này trong đúng lần chạy này.',
            },
            { label: 'Từ chối', description: 'Từ chối đúng lệnh gọi này.' },
          ],
        },
      ],
      actionDigest: digest,
      status: 'pending',
      createdAt: this.deps.now(),
    };
    run.approvals.set(digest, questionId);
    void this.commit(
      [{ entity: 'question', op: 'put', id: questionId, value: question }],
      this.state().revision,
    )
      .then(() => {
        this.logEntry(run.sessionId, run.runEpoch, {
          kind: 'question',
          text: `Chờ người dùng duyệt ${request.toolName}: ${reason}`,
        });
      })
      .catch((error) => {
        run.approvals.delete(digest);
        console.error('[CompanyRuntime] Could not persist an approval question.', error);
      });
    return `Waiting for the user to answer: ${reason}`;
  }

  /**
   * A native subagent consumes a model call the company budget already granted.
   * It is allowed only while that budget is free, and never as a writer: the
   * child's tools are the read-only set, so it cannot take a write scope the
   * parent does not hold.
   */
  private authorizeSubagent(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'authorize_subagent' }>,
  ): OmpBridgeSubagentAuthorization {
    // Every refusal comes FIRST. A spawn key that was refused must never be
    // treated as already-admitted on a retry, so nothing that cannot be
    // authorized is ever allowed to create a lease.
    if (request.invocationKind !== 'task') {
      return {
        allow: false,
        reason:
          'Only task invocations are supported by a Company run; eval and any unrecognised invocation are refused.',
      };
    }
    const key = this.childLeaseKey(run, request.spawnKey, request.invocationKind, request.agent);
    if (this.childLeases.has(key)) {
      // A repeated spawn key is the SAME child being gated twice, not a second
      // child, so it must not consume a second lease.
      return {
        allow: true,
        reason: 'This native child was already admitted under the shared model-call budget.',
        note: key,
      };
    }
    // The budget is shared with the role runs that are already live: a Director,
    // Advisor, QA or Judge turn is a model call too, so counting only dispatched
    // workers would let a child spawn push the company over its limit.
    const capacity = this.scheduler.capacitySnapshot();
    const liveRoleCalls = this.runs.size;
    if (
      liveRoleCalls + capacity.modelCalls + this.childLeases.size >=
      capacity.limits.maxConcurrentModelCalls
    ) {
      return {
        allow: false,
        reason: 'No shared model-call capacity is free, so a native child spawn is refused.',
      };
    }
    // The lease is reserved BEFORE the spawn is allowed, so two children racing
    // for the last slot cannot both win.
    this.childLeases.set(key, { sessionId: run.sessionId, runEpoch: run.runEpoch });
    return {
      allow: true,
      reason: 'A read-only native child was admitted within the shared model-call budget.',
      note: key,
    };
  }

  // ── Company tools ────────────────────────────────────────────────────────

  private async handleCompanyTool(
    run: ActiveRun,
    request: Extract<OmpBridgeRpcRequest, { method: 'company_tool' }>,
  ): Promise<Record<string, unknown>> {
    const payload = request.payload;
    if (request.toolName === 'company_submit_contract') {
      return this.submitContract(run, payload);
    }
    if (request.toolName === 'company_architecture_review') {
      return this.submitArchitectureReview(run, payload);
    }
    if (request.toolName === 'company_task_result') {
      return this.submitTaskResult(run, payload);
    }
    if (request.toolName === 'company_qa_result') {
      return this.submitQaResult(run, payload);
    }
    if (request.toolName === 'company_judge_result') {
      return this.submitJudgeResult(run, payload);
    }
    if (request.toolName === 'company_verify') {
      return this.runVerificationCommand(run, payload);
    }
    if (request.toolName === 'company_report') {
      return this.publishReport(run, payload);
    }
    if (request.toolName === 'company_ask_user') {
      return this.askUser(run, payload);
    }
    throw new OmpBridgeRpcError(
      'company_tool_unknown',
      `${request.toolName} is not a Company tool.`,
    );
  }

  private async submitContract(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['contract']);
    const proposal = readRecord(payload, 'contract');
    if (proposal === undefined) {
      throw new OmpBridgeRpcError('company_payload_invalid', 'contract must be an object.');
    }
    const coordinator = this.coordinator();
    const promptId = this.promptIdForSession(coordinator.readState(), run.sessionId);
    if (promptId === undefined) {
      throw new OmpBridgeRpcError(
        'prompt_not_found',
        'This Director run has no prompt to plan against.',
      );
    }
    await coordinator.submitContractDraft({
      sessionId: run.sessionId,
      runEpoch: run.runEpoch,
      promptId,
      proposal: normalizeContractProposal(proposal),
    });
    const contract = this.findContractForPrompt(coordinator.readState(), promptId);
    if (contract !== undefined) {
      // A submitted draft waits: nothing is implemented and no worker exists
      // until the user approves it. The Advisor reviews the draft itself.
      await this.dispatchReviewer(
        'advisor',
        contract,
        `Review this Contract and record the verdict with company_architecture_review.`,
      );
    }
    return { accepted: true };
  }

  private promptIdForSession(state: CompanyState, sessionId: string): string | undefined {
    return Object.values(state.prompts)
      .filter((prompt) => prompt.targetSessionId === sessionId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0]?.id;
  }

  private findContractForPrompt(state: CompanyState, promptId: string): Contract | undefined {
    return Object.values(state.contracts).find((contract) => contract.promptIds.includes(promptId));
  }

  private async submitArchitectureReview(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['contractId', 'revision', 'verdict', 'issues', 'advisorNotes']);
    const contractId = readString(payload, 'contractId');
    const revision = readNumber(payload, 'revision');
    const verdict = readString(payload, 'verdict');
    if (contractId === undefined || revision === undefined || verdict === undefined) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'contractId, revision and verdict are required for an architecture review.',
      );
    }
    if (verdict !== 'approve' && verdict !== 'changes_requested') {
      throw new OmpBridgeRpcError('company_payload_invalid', `Unknown verdict: ${verdict}.`);
    }
    const issues = (readRecordArray(payload, 'issues') ?? []).map((issue) => normalizeIssue(issue));
    await this.coordinator().submitArchitectureReview({
      sessionId: run.sessionId,
      runEpoch: run.runEpoch,
      contractId,
      revision,
      verdict,
      issues,
      advisorNotes: readStringArray(payload, 'advisorNotes') ?? [],
    });
    // A blocking review leaves the draft in review: only its Director can fix
    // it, so the findings go back to that Director. Scheduled after this RPC
    // answers, like every other hand-off from inside a tool call, because the
    // bridge holds the Advisor's answer until the chain it starts returns.
    const contract = this.state().contracts[contractId];
    if (contract?.status === 'architecture_review') {
      queueMicrotask(() => {
        void this.returnDraftToDirector(contract, issues).catch((error: unknown) => {
          console.error('[Company] Returning the draft to its Director failed.', error);
        });
      });
    }
    return { accepted: true };
  }

  /** Hand the Advisor's blocking findings to the Director that wrote the draft. */
  private async returnDraftToDirector(
    contract: Contract,
    issues: readonly CompanyArchitectureIssue[],
  ): Promise<void> {
    const state = this.state();
    const director = contract.promptIds
      .map((id) => state.prompts[id]?.targetSessionId)
      .find((id): id is string => id !== undefined && state.sessions[id]?.role === 'director');
    if (director === undefined) return;
    const findings = issues
      .map((issue) => `- ${issue.severity} [${issue.requirementIds.join(', ')}] ${issue.fix}`)
      .join('\n');
    await this.dispatchTurn(director, {
      text:
        `The Advisor asked for changes to Contract ${contract.code} revision ${contract.revision}:\n${findings}\n` +
        'Fix these and submit the whole Contract again with company_submit_contract; it becomes the next revision of the same Contract.',
      delivery: 'follow_up',
      attachments: [],
    });
  }

  private async submitTaskResult(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['taskId', 'attemptId', 'summary', 'changes']);
    const taskId = readString(payload, 'taskId');
    const attemptId = readString(payload, 'attemptId');
    if (taskId === undefined || attemptId === undefined) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'taskId and attemptId are required for a task result.',
      );
    }
    const input: WorkerTaskResultInput = {
      sessionId: run.sessionId,
      runEpoch: run.runEpoch,
      taskId,
      attemptId,
      summary: readString(payload, 'summary') ?? 'No summary was provided.',
      changes: (readRecordArray(payload, 'changes') ?? []).map((row) => normalizeChange(row)),
    };
    const outcome = await this.coordinator().submitTaskResult(input);
    // A worker result is not an outcome yet: it is evidence for QA. Without this
    // the chain stopped at the Worker and nothing was ever verified or judged.
    // The reviewer dispatch happens AFTER this handler answers. Awaiting it
    // inside the tool call deadlocked: dispatching parks an idle run and sends a
    // prompt, and the bridge will not deliver this tool's response until that
    // chain finishes, while the chain waits on this turn to end. It is scheduled
    // with a catch so a failure is logged rather than becoming a silent rejection.
    queueMicrotask(() => {
      void this.dispatchReviewerOrQueue('qa', taskId, attemptId).catch((error: unknown) => {
        console.error('[Company] QA dispatch failed.', error);
      });
    });
    return { accepted: true, revision: outcome.revision, taskStatus: outcome.taskStatus };
  }

  /**
   * Hand one finished attempt to QA.
   *
   * The instruction names the task, the attempt and the command ids already bound
   * to that task's criteria: `company_verify` takes a `commandId`, and QA cannot
   * choose which check applies to which criterion.
   */
  private async dispatchQaForTask(taskId: string, attemptId: string): Promise<boolean> {
    const state = this.state();
    const task = state.tasks[taskId];
    if (task === undefined) return true;
    const contract = state.contracts[task.contractId];
    if (contract === undefined) return true;
    const commandIds = Object.entries(state.settings.verificationProfiles)
      .filter(([, profile]) => profile.criterionIds.some((id) => task.acceptance.includes(id)))
      .flatMap(([, profile]) => profile.commands.map((command) => command.id))
      .filter((id) => approvedVerificationCommand(state, task, id) !== undefined);
    const session = await this.acquireReviewerSession('qa', this.workstreamOf(contract));
    if (session === undefined) return false;
    // QA is only allowed to report on the task its session is actively working
    // on, so the binding is committed BEFORE the prompt is delivered. Routing
    // this through the generic reviewer dispatch left the session with no active
    // task and every verdict was refused.
    await this.commit(
      [
        {
          entity: 'session',
          op: 'put',
          id: session.id,
          value: {
            ...session,
            activeTaskId: task.id,
            status: 'busy',
            lastUsedAt: this.deps.now(),
          },
        },
      ],
      this.state().revision,
    );
    // A task proven only by "review"/"surface" criteria has no command to run;
    // QA still has to look. Returning early here left such a task in
    // `verifying` forever with nobody assigned to verify it.
    const how =
      commandIds.length > 0
        ? `Run ${commandIds.join(', ')} with company_verify. Evidence: (fill in from the company_verify result). `
        : 'No command proves these criteria: read the files the task changed and judge them against the criteria yourself. ';
    await this.dispatchTurn(session.id, {
      text: this.composePromptText(
        { ...session, status: 'busy' },
        `Contract ${contract.code}, id ${contract.id}, revision ${contract.revision}. ` +
          `Verify task ${task.code} (task id ${task.id}, attempt id ${attemptId}). ` +
          how +
          `Criteria: ${task.acceptance.join(', ')}. ` +
          `Submit the verdict with company_qa_result.`,
      ),
      delivery: 'prompt',
      attachments: [],
    });
    return true;
  }

  /**
   * Dispatch a reviewer, or remember the request when every runner slot is taken.
   *
   * Returns true when there is nothing left to retry.
   */
  private async dispatchReviewerOrQueue(
    role: ReviewerRole,
    taskId: string,
    attemptId: string,
  ): Promise<boolean> {
    const send = async (): Promise<boolean> =>
      role === 'judge'
        ? await this.dispatchJudgeForTask(taskId, attemptId)
        : await this.dispatchQaForTask(taskId, attemptId);
    if (await send()) return true;
    // Waiting for the next idle transition deadlocked: the session that just
    // reported a result never goes idle on its own, so nothing would ever free a
    // slot for this request. Park one genuinely idle session and try again now;
    // only queue if there is still nothing safe to park.
    if ((await this.parkOneIdleSession()) && (await send())) return true;
    this.pendingReviewerDispatches.push({ role, taskId, attemptId });
    return false;
  }

  /** QA asked to run one approved command; it runs for real and reports back. */
  private async runVerificationCommand(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['taskId', 'attemptId', 'commandId']);
    const taskId = readString(payload, 'taskId');
    const attemptId = readString(payload, 'attemptId');
    const commandId = readString(payload, 'commandId');
    if (taskId === undefined || attemptId === undefined || commandId === undefined) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'taskId, attemptId and commandId are required to run a verification command.',
      );
    }
    const request: VerificationRequest = {
      sessionId: run.sessionId,
      runEpoch: run.runEpoch,
      taskId,
      attemptId,
      commandId,
    };
    const outcome = await this.coordinator().verifyTask(request);
    await this.logCommand(run, request, outcome);
    return {
      status: outcome.status,
      evidenceId: outcome.evidenceId,
      criterionIds: [...outcome.criterionIds],
      reason: outcome.reason,
      ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    };
  }

  private async submitQaResult(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const input = this.readReviewerInput(run, payload);
    const outcome = await this.coordinator().submitQaResult(input);
    this.logVerdict(run, 'qa', input);
    await this.afterReview(run, input, outcome.verdict, outcome.taskStatus);
    return { accepted: true, revision: outcome.revision, taskStatus: outcome.taskStatus };
  }

  private async submitJudgeResult(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const input = this.readReviewerInput(run, payload);
    const outcome = await this.coordinator().submitJudgeResult(input);
    this.logVerdict(run, 'judge', input);
    await this.afterReview(run, input, outcome.verdict, outcome.taskStatus);
    return { accepted: true, revision: outcome.revision, taskStatus: outcome.taskStatus };
  }

  private readReviewerInput(run: ActiveRun, payload: Record<string, unknown>): ReviewerResultInput {
    assertKnownKeys(payload, [
      'taskId',
      'attemptId',
      'verdict',
      'criterionIds',
      'evidenceIds',
      'notes',
    ]);
    const taskId = readString(payload, 'taskId');
    const attemptId = readString(payload, 'attemptId');
    const verdict = readString(payload, 'verdict');
    if (taskId === undefined || attemptId === undefined || verdict === undefined) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'taskId, attemptId and verdict are required for a reviewer result.',
      );
    }
    if (verdict !== 'pass' && verdict !== 'fail') {
      throw new OmpBridgeRpcError('company_payload_invalid', `Unknown verdict: ${verdict}.`);
    }
    return {
      sessionId: run.sessionId,
      runEpoch: run.runEpoch,
      taskId,
      attemptId,
      verdict,
      criterionIds: readStringArray(payload, 'criterionIds') ?? [],
      evidenceIds: readStringArray(payload, 'evidenceIds') ?? [],
      notes: readStringArray(payload, 'notes') ?? [],
    };
  }

  /**
   * After a reviewer spoke: a pass that closes the task lets the DAG continue;
   * a requested change goes back to the SAME worker for one bounded repair, and
   * a task that runs out of repairs is reported blocked rather than looping.
   */
  private async afterReview(
    run: ActiveRun,
    input: ReviewerResultInput,
    verdict: 'pass' | 'fail',
    taskStatus: Task['status'],
  ): Promise<void> {
    if (verdict === 'pass' && taskStatus === 'done') {
      this.scheduler.release(input.taskId);
      const task = this.state().tasks[input.taskId];
      // Publishing the report can start another Judge turn, so it is scheduled
      // after this RPC answers for the same reason the next dispatch is: the
      // bridge will not deliver the verdict until the chain it starts finishes.
      if (task !== undefined) {
        queueMicrotask(() => {
          void this.maybePublishReport(task.contractId).catch((error: unknown) => {
            console.error('[Company] report publish failed.', error);
          });
        });
      }
      this.requestDispatch();
      return;
    }
    if (verdict === 'pass' && run.role === 'qa') {
      // A QA pass is evidence, not an outcome: only the Judge closes a task.
      // Falling through here left the chain stopped after QA with nothing
      // scheduled and no task ever reaching `done`.
      queueMicrotask(() => {
        void this.dispatchReviewerOrQueue('judge', input.taskId, input.attemptId).catch(
          (error: unknown) => {
            console.error('[Company] Judge dispatch failed.', error);
          },
        );
      });
      return;
    }
    if (verdict === 'fail') await this.requestRepair(run, input);
  }

  /**
   * Hand one QA-passed attempt to the Judge.
   *
   * The Judge's verdict is the only thing that may close a task, so it must be
   * bound to the same task its session is reviewing and told the attempt and the
   * evidence the Judge is being asked to weigh.
   */
  private async dispatchJudgeForTask(taskId: string, attemptId: string): Promise<boolean> {
    const state = this.state();
    const task = state.tasks[taskId];
    if (task === undefined) return true;
    const contract = state.contracts[task.contractId];
    if (contract === undefined) return true;
    const attempt = state.attempts[attemptId];
    const evidenceIds = [...new Set([...(attempt?.evidenceIds ?? [])])];
    const session = await this.acquireReviewerSession('judge', this.workstreamOf(contract));
    if (session === undefined) return false;
    await this.commit(
      [
        {
          entity: 'session',
          op: 'put',
          id: session.id,
          value: { ...session, activeTaskId: task.id, status: 'busy', lastUsedAt: this.deps.now() },
        },
      ],
      this.state().revision,
    );
    await this.dispatchTurn(session.id, {
      text: this.composePromptText(
        { ...session, status: 'busy' },
        `Contract ${contract.code}, id ${contract.id}, revision ${contract.revision}. ` +
          `Judge task ${task.code} (task id ${task.id}, attempt id ${attemptId}). ` +
          `Evidence: ${evidenceIds.join(', ')}. Criteria: ${task.acceptance.join(', ')}. ` +
          `Submit both with the verdict to company_judge_result.`,
      ),
      delivery: 'prompt',
      attachments: [],
    });
    return true;
  }

  private async requestRepair(run: ActiveRun, input: ReviewerResultInput): Promise<void> {
    const task = this.state().tasks[input.taskId];
    if (task === undefined) return;
    if (task.attemptIds.length >= MAX_REPAIR_ATTEMPTS) {
      await this.commit(
        [
          {
            entity: 'task',
            op: 'put',
            id: task.id,
            value: {
              ...task,
              status: 'failed',
              routeReason: `đã hết ${MAX_REPAIR_ATTEMPTS} lần thử sửa chữa`,
            },
          },
        ],
        this.state().revision,
      );
      this.scheduler.release(task.id);
      return;
    }
    const worker = task.sessionId === undefined ? undefined : this.runs.get(task.sessionId);
    if (worker === undefined) {
      // The original worker is gone; the task returns to the queue rather than
      // being repaired by a session that never saw the work.
      await this.commit(
        [
          {
            entity: 'task',
            op: 'put',
            id: task.id,
            value: {
              ...task,
              status: 'ready',
              routeReason: 'đã yêu cầu sửa chữa; nhân viên gốc không còn tồn tại',
            },
          },
        ],
        this.state().revision,
      );
      this.scheduler.release(task.id);
      this.requestDispatch();
      return;
    }
    const attempt: Attempt = {
      id: randomUUID(),
      taskId: task.id,
      sessionId: worker.sessionId,
      runEpoch: worker.runEpoch,
      startedAt: this.deps.now(),
      status: 'running',
      changes: [],
      evidenceIds: [],
    };
    await this.commit(
      [
        {
          entity: 'task',
          op: 'put',
          id: task.id,
          value: {
            ...task,
            status: 'changes_requested',
            attemptIds: [...task.attemptIds, attempt.id],
            routeReason: `được ${ROLE_LABELS[run.role] ?? run.role} yêu cầu sửa chữa`,
          },
        },
        { entity: 'attempt', op: 'put', id: attempt.id, value: attempt },
      ],
      this.state().revision,
    );
    await this.dispatchTurn(worker.sessionId, {
      // The repair packet must carry the same explicit identity as the first
      // dispatch: `company_task_result` takes a taskId and an attemptId, and a
      // Worker told only the display code reported an empty pair and did nothing.
      text: `The reviewers asked for changes on ${task.code} (task id ${task.id}, attempt id ${attempt.id}). Repair the work inside the same write scopes and report again with company_task_result.`,
      delivery: 'follow_up',
      attachments: [],
    });
  }

  private async maybePublishReport(contractId: string): Promise<void> {
    const contract = this.state().contracts[contractId];
    if (contract === undefined) return;
    if (contract.tasks.some((task) => task.status !== 'done')) return;
    await this.dispatchReviewer(
      'judge',
      contract,
      `Every task in ${contract.code} is done. Publish the final report with company_report.`,
    );
  }

  private async publishReport(
    _run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['contractId']);
    const contractId = readString(payload, 'contractId');
    if (contractId === undefined) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'contractId is required for a report.',
      );
    }
    const state = this.state();
    const contract = state.contracts[contractId];
    if (contract === undefined) {
      throw new OmpBridgeRpcError('contract_not_found', `Unknown contract: ${contractId}.`);
    }
    if (contract.tasks.some((task) => task.status !== 'done')) {
      throw new OmpBridgeRpcError(
        'contract_incomplete',
        'A report can only be published for a Contract whose tasks are all done.',
      );
    }
    const commands = new Map<string, readonly string[]>();
    for (const task of contract.tasks) {
      for (const [criterionId, commandIds] of approvedCommandsByCriterion(state, task)) {
        commands.set(criterionId, commandIds);
      }
    }
    const report: CompanyReport = buildCompanyReport(state, contractId, commands);
    await this.commit(
      [{ entity: 'report', op: 'put', id: contractId, value: report }],
      this.state().revision,
    );
    return { accepted: true, contractId, revision: report.revision };
  }

  private async askUser(
    run: ActiveRun,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    assertKnownKeys(payload, ['title', 'questions']);
    const title = readString(payload, 'title');
    const rows = readRecordArray(payload, 'questions');
    if (title === undefined || rows === undefined || rows.length === 0) {
      throw new OmpBridgeRpcError(
        'company_payload_invalid',
        'title and a non-empty questions array are required to ask the user.',
      );
    }
    const session = this.state().sessions[run.sessionId];
    const id = randomUUID();
    const question: Question = {
      id,
      sessionId: run.sessionId,
      ...(session?.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
      runEpoch: run.runEpoch,
      kind: 'clarification',
      title,
      questions: rows.map((row) => normalizeQuestionPrompt(row)),
      status: 'pending',
      createdAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'question', op: 'put', id, value: question }],
      this.state().revision,
    );
    return { accepted: true, questionId: id };
  }

  // ── Recovery, parking, shutdown ──────────────────────────────────────────

  /**
   * Seed the settings with verification profiles this workspace actually has.
   *
   * Discovery reads the manifest and the lockfile and resolves each script to a
   * real, shell-free command; it installs nothing and migrates nothing. Existing
   * profiles are never overwritten — an approved Contract may already be bound to
   * them, and re-resolving would silently change what an approved command runs.
   */
  private async seedVerificationProfiles(): Promise<void> {
    const settings = this.state().settings;
    if (Object.keys(settings.verificationProfiles).length > 0) return;
    const discovered = await discoverVerificationProfiles(this.store.workspacePath);
    if (discovered.profiles.length === 0) return;
    await this.commit(
      [
        {
          entity: 'settings',
          op: 'put',
          id: 'settings',
          value: {
            ...this.state().settings,
            verificationProfiles: Object.fromEntries(
              discovered.profiles.map((profile) => [profile.id, profile]),
            ),
          },
        },
      ],
      this.state().revision,
    );
  }

  /**
   * Reconcile with a journal that may describe runs this process never started.
   *
   * Work is never resumed here. A session that was live when the previous owner
   * went away is recorded as crashed, its attempts are marked interrupted and
   * its questions are cancelled; restarting it is the user's decision, and the
   * parked handoff is what a later run starts from.
   */
  private async recover(state: CompanyState): Promise<void> {
    // Recovery runs BEFORE the coordinator finishes starting, so it must not
    // write: the reconciliation is computed here and committed by the first
    // post-start pass instead.
    for (const session of Object.values(state.sessions)) this.pool.upsert(session);
    this.pendingRecovery = reconcileInterruptedWork(state, this.deps.now());
    for (const session of Object.values(state.sessions)) {
      if (!sessionHoldsRunner(session)) continue;
      this.sessionLog.record(session.id, {
        kind: 'state',
        runEpoch: session.runEpoch,
        ...(session.activeTaskId === undefined ? {} : { taskId: session.activeTaskId }),
        text: 'Phiên đã sập: tiến trình không còn chạy sau khi máy chủ khởi động lại.',
      });
    }
  }

  /**
   * Park the sessions the pool agrees are done: idle long enough, no active task, no pending
   * question and no attached terminal. A refusal is ignored, because the pool is the authority and
   * the sweep only offers. Squad sessions are left to the squad, which parks them on its own timer.
   */
  private async parkIdleSessions(): Promise<void> {
    for (const session of Object.values(this.state().sessions)) {
      if (isSquadWorkstream(session.workstreamId)) continue;
      const run = this.runs.get(session.id);
      if (run === undefined || run.busy || run.liveTools.size > 0) continue;
      await this.parkRun(session, run);
    }
  }

  /**
   * Parks one squad session the squad no longer needs, so its process stops and its memory frees.
   * False when the session is not a live squad session or the pool refuses to park it now.
   */
  async parkSquadSession(sessionId: string): Promise<boolean> {
    const session = this.state().sessions[sessionId];
    const run = this.runs.get(sessionId);
    if (session === undefined || run === undefined || !isSquadWorkstream(session.workstreamId)) {
      return false;
    }
    if (run.busy || run.liveTools.size > 0) return false;
    return this.parkRun(session, run);
  }

  /** Stops one idle session's process and records it parked, when the pool agrees. */
  private async parkRun(session: CompanySession, run: ActiveRun): Promise<boolean> {
    const state = this.state();
    const questions = Object.values(state.questions).filter((q) => q.status === 'pending');
    const attached = [...this.runs.values()]
      .filter((entry) => this.gateway.hasViewer(entry.sessionId, entry.runEpoch))
      .map((entry) => entry.sessionId);
    const decision = this.pool.planPark(session.id, {
      questions,
      attachedTerminalSessionIds: attached,
    });
    if (!decision.park) return false;
    await this.stopRun(run, 'the session was idle and parked');
    const parked: CompanySession = {
      ...session,
      status: 'parked',
      lastUsedAt: this.deps.now(),
    };
    await this.commit(
      [{ entity: 'session', op: 'put', id: session.id, value: parked }],
      this.state().revision,
    );
    this.pool.upsert(parked);
    this.logEntry(session.id, session.runEpoch, {
      kind: 'state',
      text: 'Phiên đã đậu sau thời gian rảnh.',
    });
    return true;
  }

  private onPtyEvent(event: { type: string; sessionId: string; exitCode?: number }): void {
    if (event.type !== 'exit') return;
    const separator = event.sessionId.indexOf(':');
    if (separator < 1) return;
    const sessionId = event.sessionId.slice(0, separator);
    const epoch = Number(event.sessionId.slice(separator + 1));
    const run = this.runs.get(sessionId);
    if (run === undefined || run.runEpoch !== epoch) return;
    this.onMessage({
      type: 'terminalClosed',
      sessionId,
      runEpoch: epoch,
      seq: this.gateway.nextSeq(sessionId, epoch),
      reason: `the native process exited with code ${String(event.exitCode)}`,
    });
  }

  /**
   * Shut the runtime down.
   *
   * Timers stop first, then every run is stopped through the supervisor, which
   * verifies ownership before it signals anything. The PTY helper is disposed
   * ONLY when the supervisor reports nothing blocked: `op:'dispose'` kills every
   * PTY the helper holds, so using it while a run is blocked would kill a process
   * the supervisor could not prove we own, by a side door. When something is
   * blocked the helper is left running and detached, and the blocked resource
   * stays visible to the operator instead of being quietly reaped.
   */
  setLiveRunnerLimits(live: number, retained: number): void {
    this.pool.setLiveRunnerLimits(live, retained);
    this.scheduler.setLiveRunnerLimit(live);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) this.deps.clearInterval(timer);
    this.timers.length = 0;
    this.ptySubscription?.();
    this.ptySubscription = null;
    for (const run of [...this.runs.values()]) {
      await this.stopRun(run, 'the Company runtime shut down');
    }
    await this.sessionLog.drain();
    const report = await this.supervisor.dispose();
    if (report.blocked.length > 0) {
      for (const entry of report.blocked) {
        console.error(
          `[CompanyRuntime] run ${entry.runId} could not be stopped (${entry.code}); its process was left running.`,
        );
      }
      return;
    }
    await this.ptyClient.dispose();
  }
}

/**
 * The changes a restart owes the journal, computed without writing anything.
 *
 * A session whose process did not survive is recorded as crashed, its running
 * attempts as interrupted and its pending questions as cancelled. Nothing here
 * starts a process: restarting is the user's decision.
 */
function reconcileInterruptedWork(state: CompanyState, now: string): CompanyChange[] {
  const changes: CompanyChange[] = [];
  for (const session of Object.values(state.sessions)) {
    if (!sessionHoldsRunner(session)) continue;
    changes.push({
      entity: 'session',
      op: 'put',
      id: session.id,
      value: { ...session, status: 'crashed', lastUsedAt: now },
    });
  }
  for (const attempt of Object.values(state.attempts)) {
    if (attempt.status !== 'running') continue;
    changes.push({
      entity: 'attempt',
      op: 'put',
      id: attempt.id,
      value: {
        ...attempt,
        status: 'interrupted',
        endedAt: now,
        error: 'The run did not survive a restart.',
      },
    });
  }
  for (const question of Object.values(state.questions)) {
    if (question.status !== 'pending') continue;
    changes.push({
      entity: 'question',
      op: 'put',
      id: question.id,
      value: { ...question, status: 'cancelled', resolvedAt: now },
    });
  }
  return changes;
}

function normalizeChange(row: Record<string, unknown>): WorkspaceChangeInput {
  const path = readString(row, 'path');
  const kind = readString(row, 'kind');
  if (path === undefined || (kind !== 'create' && kind !== 'modify' && kind !== 'delete')) {
    throw new OmpBridgeRpcError(
      'company_payload_invalid',
      'Each change needs a path and a kind of create, modify or delete.',
    );
  }
  const diffArtifactId = readString(row, 'diffArtifactId');
  return {
    path,
    kind,
    summary: readString(row, 'summary') ?? '',
    ...(diffArtifactId === undefined ? {} : { diffArtifactId }),
  };
}

function normalizeIssue(row: Record<string, unknown>): CompanyArchitectureIssue {
  const severity = readString(row, 'severity');
  const message = readString(row, 'message');
  if (
    message === undefined ||
    (severity !== 'P0' && severity !== 'P1' && severity !== 'P2' && severity !== 'P3')
  ) {
    throw new OmpBridgeRpcError(
      'company_payload_invalid',
      'Each issue needs a message and a P0-P3 severity.',
    );
  }
  return {
    severity,
    requirementIds: readStringArray(row, 'requirementIds') ?? [],
    evidence: readStringArray(row, 'evidence') ?? [],
    fix: message,
  };
}

/**
 * The top-level shape of a model-authored Contract proposal.
 *
 * A model authors this as free text, so every field the draft normalizer
 * dereferences is checked HERE, at the boundary. The deep validator downstream
 * judges the proposal's meaning, not its shape, and would throw a bare
 * `TypeError` on a missing nested collection — which reaches the Director as an
 * opaque "the host failed" instead of the field it must fix.
 */
function normalizeContractProposal(proposal: Record<string, unknown>): ContractDraftProposal {
  const collections = ['requirements', 'phases', 'tasks', 'assumptions', 'decisions', 'acceptance'];
  const missing = collections.filter((key) => !Array.isArray(proposal[key]));
  if (missing.length > 0) {
    throw new OmpBridgeRpcError(
      'company_payload_invalid',
      `A Contract proposal needs these collections: ${missing.join(', ')}.`,
    );
  }
  const problems: string[] = [];
  for (const [index, phase] of (proposal['phases'] as unknown[]).entries()) {
    if (!isPlainRecord(phase)) {
      problems.push(`phase ${index} is not an object`);
      continue;
    }
    for (const key of ['id', 'title']) {
      if (typeof phase[key] !== 'string') problems.push(`phase ${index} has no ${key}`);
    }
    if (typeof phase['ordinal'] !== 'number') problems.push(`phase ${index} has no ordinal`);
    for (const key of ['taskIds', 'acceptanceIds']) {
      if (!Array.isArray(phase[key])) problems.push(`phase ${index} has no ${key} list`);
    }
  }
  for (const [index, task] of (proposal['tasks'] as unknown[]).entries()) {
    if (!isPlainRecord(task)) {
      problems.push(`task ${index} is not an object`);
      continue;
    }
    for (const key of ['id', 'phaseId', 'title', 'workstreamId', 'executionMode', 'routeReason']) {
      if (typeof task[key] !== 'string') problems.push(`task ${index} has no ${key}`);
    }
    for (const key of ['requirementIds', 'dependsOn', 'sharedResources', 'acceptance']) {
      if (!Array.isArray(task[key])) problems.push(`task ${index} has no ${key} list`);
    }
    for (const key of ['readScopes', 'writeScopes']) {
      if (!Array.isArray(task[key])) {
        problems.push(`task ${index} has no ${key} list`);
        continue;
      }
      for (const scope of task[key] as unknown[]) {
        if (!isPlainRecord(scope)) {
          problems.push(`task ${index} has a malformed ${key} entry`);
        } else if (typeof scope['path'] !== 'string' || !Array.isArray(scope['operations'])) {
          problems.push(`task ${index} has a ${key} entry without a path and operations`);
        }
      }
    }
  }
  for (const [index, criterion] of (proposal['acceptance'] as unknown[]).entries()) {
    if (!isPlainRecord(criterion)) {
      problems.push(`criterion ${index} is not an object`);
    } else if (typeof criterion['id'] !== 'string' || !Array.isArray(criterion['requirementIds'])) {
      problems.push(`criterion ${index} needs an id and a requirementIds list`);
    }
  }
  if (problems.length > 0) {
    throw new OmpBridgeRpcError(
      'company_payload_invalid',
      `The Contract proposal is malformed: ${problems.join('; ')}.`,
    );
  }
  return proposal as unknown as ContractDraftProposal;
}

function normalizeQuestionPrompt(row: Record<string, unknown>): QuestionPrompt {
  const question = readString(row, 'question');
  const options = readRecordArray(row, 'options');
  if (question === undefined || options === undefined || options.length === 0) {
    throw new OmpBridgeRpcError(
      'company_payload_invalid',
      'Each question needs text and at least one option.',
    );
  }
  return {
    id: readString(row, 'id') ?? randomUUID(),
    question,
    options: options.map((option) => normalizeQuestionOption(option)),
  };
}

function normalizeQuestionOption(row: Record<string, unknown>): QuestionOption {
  const label = readString(row, 'label');
  if (label === undefined) {
    throw new OmpBridgeRpcError('company_payload_invalid', 'Each option needs a label.');
  }
  const description = readString(row, 'description');
  return description === undefined ? { label } : { label, description };
}

/**
 * Compose the runtime. Prerequisites are resolved eagerly, so a machine without
 * a usable OMP is told so once, with a code the caller can branch on, instead of
 * surfacing later as a mysterious launch failure.
 */
export async function createCompanyRuntime(
  options: CompanyRuntimeOptions,
): Promise<CompanyRuntime> {
  return NativeCompanyRuntime.open(options);
}

/**
 * The role whose model a session runs: its own, except a chat session a squad opened under a role
 * key (`squad:worker:<repo>`), which runs as that role's model while it takes prompts directly.
 */
function modelRoleOf(role: CompanyRole, workstreamId: string): CompanyRole {
  return role === 'chat' ? (squadWorkstreamRole(workstreamId) ?? role) : role;
}

/** What a resolved question recorded, per question id. The record is loosely typed; the engine wrote it from a checked answer. */
function recordedAnswers(question: Question): QuestionAnswerInput['answers'] {
  const answers: unknown = question.answer?.['answers'];
  return typeof answers === 'object' && answers !== null ? (answers as QuestionAnswerInput['answers']) : {};
}

/** A board answer as the native ask reads it: the chosen labels and any typed text, per question. */
function nativeAnswers(question: Question, answers: QuestionAnswerInput['answers']): OmpBridgeQuestionAnswer[] {
  return question.questions.flatMap((prompt) => {
    const given = answers[prompt.id];
    if (given === undefined) return [];
    const selectedOptions = given.selectedIndices.flatMap((index) => {
      const label = prompt.options[index]?.label;
      return label === undefined ? [] : [label];
    });
    const customInput = given.text !== undefined && given.text.trim() !== '' ? given.text : undefined;
    if (selectedOptions.length === 0 && customInput === undefined) return [];
    return [
      {
        id: prompt.id,
        selectedOptions,
        ...(customInput === undefined ? {} : { customInput }),
        multi: prompt.multi === true,
      },
    ];
  });
}

/** A chat session the board opened for a work item, under a role key: no one watches its terminal. */
function isWorkItemSession(session: CompanySession): boolean {
  return session.role === 'chat' && squadWorkstreamRole(session.workstreamId) !== undefined;
}
