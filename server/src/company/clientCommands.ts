/**
 * clientCommands: the single dispatcher for every Company and terminal command.
 *
 * Both surfaces route through here so authorization, limits and validation
 * cannot drift between the standalone server and the VS Code extension.
 *
 * Order of checks is deliberate and identical for every command:
 *   1. privilege -- an unprivileged socket is refused before any workspace,
 *      filesystem or process work happens, so an observer client cannot even
 *      probe which ids exist.
 *   2. surface availability -- a command with no coordinator answers
 *      `company_unavailable` instead of hanging on a pending promise.
 *   3. shape and limits -- request ids, byte budgets and path containment,
 *      checked before delegating.
 *   4. execution -- the coordinator or store performs the effect; a rejection
 *      from either surfaces as its own error code rather than a generic
 *      failure, because the client shows the difference to the user.
 *
 * A successful mutation does NOT carry the new revision: the client learns it
 * from the next `companyStateChanged`, so a command never needs a second full
 * projection of the company just to stamp a result.
 *
 * Nothing here queues. Terminal input is written once or dropped with an
 * explicit code: replaying keystrokes after a reconnect would re-submit text
 * the user already sent.
 */

import { createHash } from 'node:crypto';

import type {
  AgentInfo,
  CompanyModelCatalogEntry,
  PromptAttachment,
  QuestionAnswerInput,
  RoleProfile,
  SubmitPromptInput,
} from '../../../core/src/company.js';
import type {
  CompanyWorkspaceEntry,
  HerdrAgentsMessage,
  ServerMessage,
} from '../../../core/src/messages.js';
import { isWorkItemPriority } from '../../../core/src/workItemGraph.js';
import {
  HERDR_DEFAULT_READ_LINES,
  HerdrError,
  type HerdrLink,
  isHerdrKey,
} from '../herdr/herdrLink.js';
import type { BrowserReaperControl } from './browserReaper.js';
import { readClaudeTranscriptLog } from './claudeCode/claudeTranscriptLog.js';
import type {
  CompanyCoordinator,
  CompanySessionAction,
  ContractDecision,
} from './companyCoordinator.js';
import { COMPANY_SESSION_NAME_MAX_LENGTH } from './companyCoordinator.js';
import { CompanyError } from './companyError.js';
import type { CompanyStore } from './companyStore.js';
import {
  COMPANY_ARTIFACT_PAGE_BYTES,
  COMPANY_ATTACHMENT_MAX_BYTES,
  COMPANY_DEFAULT_TERMINAL_COLS,
  COMPANY_DEFAULT_TERMINAL_ROWS,
  COMPANY_FILE_DEFAULT_PAGE_BYTES,
  COMPANY_MAX_PROMPT_BYTES,
  COMPANY_TERMINAL_INPUT_MAX_BYTES,
} from './constants.js';
import type { CompanyViewMode } from './egress.js';
import { pickFolder, resolveFolderPath } from './folderPicker.js';
import {
  isSessionLogId,
  readSessionLog,
  SESSION_LOG_DEFAULT_LIMIT,
  SESSION_LOG_MAX_LIMIT,
  sessionLogDirectory,
} from './sessionLog.js';
import type { SquadService } from './squad/squadService.js';
import type { UsageControl } from './usagePage.js';
import { isSquadSettings } from './workItems/squadSettings.js';
import { isItemRole, isWorkItemAssignee, type WorkItemDraft } from './workItems/workItemModel.js';
import type { WorkItemService } from './workItems/workItemService.js';
import { listWorkspaceFiles, readWorkspaceFile } from './workspaceFiles.js';

/** Controller lease returned by an attach; the last attach for a session wins. */
export interface CompanyTerminalHandle {
  leaseId: string;
  cols: number;
  rows: number;
  /**
   * The run's screen and scrollback (base64), painted before any live frame so a
   * fresh viewer can scroll back. Its seq is newer than every frame sent before the
   * attach. Absent where the framebuffer is not readable.
   */
  replay?: { seq: number; data: string };
}

/**
 * PTY control surface. Implemented by the terminal session owner; `null` means
 * the native capability is not installed, which the UI reports as unavailable
 * rather than substituting piped text.
 */
/**
 * A read-only view of a run's terminal, for a share link: the screen now, the output as it comes and
 * the exit. It has no way to write or resize, and taking one never moves the controller lease.
 */
export interface TerminalPeek {
  readonly cols: number;
  readonly rows: number;
  snapshot(): Promise<string>;
  onData(listener: (chunk: string) => void): () => void;
  onExit(listener: (exit: { exitCode: number; signal?: number }) => void): () => void;
}

export interface CompanyTerminalGateway {
  /** A read-only view of the session's live terminal; absent when it has no live run or this host cannot offer one. */
  peek?(sessionId: string): TerminalPeek | undefined;
  attach(
    sessionId: string,
    runEpoch: number,
    cols?: number,
    rows?: number,
    onLeaseGranted?: (leaseId: string) => void,
  ): Promise<CompanyTerminalHandle>;
  write(sessionId: string, runEpoch: number, data: string, leaseId: string): Promise<void>;
  resize(
    sessionId: string,
    runEpoch: number,
    cols: number,
    rows: number,
    leaseId: string,
  ): Promise<void>;
  detach(sessionId: string, runEpoch: number, leaseId: string): Promise<void>;
}

export interface CompanyCommandServices {
  coordinator: CompanyCoordinator;
  store: CompanyStore;
  /** Canonical workspace root every file request is resolved against. */
  workspaceRoot: string;
  /** `null` until the native PTY capability is installed. */
  terminal: CompanyTerminalGateway | null;
  /** Model catalog for the UI; resolves availability, never credentials. */
  modelCatalog(): Promise<CompanyModelCatalogEntry[]>;
  /** One managed session's description; a live run is asked, otherwise its record answers. */
  sessionInfo(sessionId: string): Promise<AgentInfo>;
  /** The folder's manual work items; absent on a follower, which cannot change them. */
  workItems?: WorkItemService;
  /** The folder's squad leader; absent on a follower, which cannot start a squad. */
  squad?: SquadService;
}

/**
 * Folder list and folder switching for this server. It sits beside the services
 * rather than inside them: it must answer while no folder is active, which is
 * exactly when the user most needs to open one.
 */
export interface CompanyWorkspaceControl {
  /** Folders for the board: the open ones first, then the recently used ones. */
  entries(): CompanyWorkspaceEntry[];
  /** Open the folder if it is not open, then make it the active one. Refusals carry a user-facing message. */
  open(workspacePath: string): Promise<void>;
  /** Services of the folder at this path, opening it first if needed, without making it active. */
  ensure(workspacePath: string): Promise<CompanyCommandServices>;
  /** Services of the open folder at this path, or `null` when it is not open. */
  servicesFor(workspacePath: string): CompanyCommandServices | null;
  /** Services of the open folder whose state holds this id, or `null` when none does. */
  servicesHolding(id: string): CompanyCommandServices | null;
  /** Services of the active folder, or `null` when none is active. */
  activeServices(): CompanyCommandServices | null;
  /** Path of the active folder, or `null` when none is active. */
  activePath(): string | null;
  /**
   * Store or clear (`null`) a folder's display name, then republish the folder list. Refusals carry a user-facing
   * message. The path must already be canonical.
   */
  setFolderName(workspacePath: string, name: string | null): void;
  /**
   * Take a folder off the list: drop its recent entry and, when it is open, stop its Company. Refused while that
   * folder has working or waiting sessions. The path is taken as listed, not resolved on disk.
   */
  forget(workspacePath: string): Promise<void>;
}

export interface CompanyCommandContext {
  /** `null` when this process has no company workspace open. */
  services: CompanyCommandServices | null;
  /** Folder list and switching; absent when this surface has no folder control. */
  workspaces?: CompanyWorkspaceControl | null;
  /** Whether this connection may run company commands at all. */
  privileged?: boolean;
  /** False in an untrusted VS Code workspace; authorized read-only views remain usable. */
  executionAllowed: boolean;
  /** Server-level herdr link; absent or `null` when this process runs without one. */
  herdr?: HerdrLink | null;
  /** Browser reaper control; absent or `null` when this process runs none. */
  browserReaper?: BrowserReaperControl | null;
  /** Usage page reader; absent or `null` when this process runs none. */
  usage?: UsageControl | null;
  /** Updates the per-socket egress lease as soon as attach rotates ownership. */
  onTerminalAttached?: (sessionId: string, leaseId: string) => void;
  /**
   * Called after a successful detach. Matching by lease prevents a delayed
   * detach reply from revoking a newer attachment for the same session.
   */
  onTerminalDetached?: (sessionId: string, leaseId: string) => void;
  /** Records the connection's company view (`all` or `folder`); the egress gate delivers accordingly. */
  onCompanyViewMode?: (mode: CompanyViewMode) => void;
  /** The connection's current company view, read when a snapshot request is answered. */
  companyViewMode?: () => CompanyViewMode;
}

type Send = (message: ServerMessage) => void;

const CONTRACT_DECISIONS: ReadonlySet<string> = new Set(['approve', 'reject']);
const SESSION_ACTIONS: ReadonlySet<string> = new Set([
  'pause',
  'resume',
  'kill',
  'restart',
  'archive',
  'interrupt',
  'delete',
]);
const PROMPT_DELIVERIES: ReadonlySet<string> = new Set(['prompt', 'steer', 'follow_up']);

const HERDR_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'herdrRead',
  'herdrPrompt',
  'herdrKeys',
  'herdrFocus',
  'herdrRename',
  'herdrClose',
  'herdrInfoRequest',
  'herdrWake',
  'herdrWatch',
]);
const HERDR_NOT_LINKED_MESSAGE = 'Máy chủ này chưa kết nối herdr.';
const HERDR_NOT_LINKED_ROSTER: HerdrAgentsMessage = {
  type: 'herdrAgents',
  available: false,
  reason: HERDR_NOT_LINKED_MESSAGE,
  agents: [],
  sleeping: [],
};
const INVALID_HERDR_REQUEST_MESSAGE = 'Yêu cầu herdr không hợp lệ.';
const HERDR_FAILED_MESSAGE = 'Không thực hiện được lệnh herdr.';

// The wire enums live in core/asyncapi.yaml; these predicates narrow a
// validated string back to the generated union the coordinator accepts.
function isContractDecision(value: string): value is ContractDecision {
  return CONTRACT_DECISIONS.has(value);
}

function isSessionAction(value: string): value is CompanySessionAction {
  return SESSION_ACTIONS.has(value);
}

function isPromptDelivery(value: string): value is SubmitPromptInput['delivery'] {
  return PROMPT_DELIVERIES.has(value);
}

/** Folder picking and folder naming commands. They answer for the folder list, so they need no open folder. */
const FOLDER_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'companyFolderPick',
  'companyFolderName',
  'companyFolderForget',
]);

/** Usage page reads. They need no open workspace, so they run before routing. */
const USAGE_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'usageLimitsRequest',
  'usageHistoryRequest',
  'usageStatsRequest',
]);

/** Message types this dispatcher owns. Everything else is not a company command. */
const COMPANY_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'companySnapshotRequest',
  ...HERDR_COMMAND_TYPES,
  'companyPromptSubmit',
  'companyContractDecision',
  'companyQuestionAnswer',
  'companySessionControl',
  'companySessionRename',
  'companySessionInfoRequest',
  'companyPromptCancel',
  'companyOmpSessionsRequest',
  'companySessionResume',
  'companyChatNew',
  'companySettingsUpdate',
  'companyModelCatalogRequest',
  'companyArtifactRequest',
  'companyFileListRequest',
  'companyFileReadRequest',
  'companySessionLogRequest',
  'companyAttachmentUpload',
  'companyWorkspaceOpen',
  'companyWorkItemCreate',
  'companyWorkItemAssign',
  'companyWorkItemFollowUp',
  'companyWorkItemMark',
  'companyWorkItemCancel',
  'companyWorkItemDependencies',
  'companyWorkItemJudge',
  'companyWorkItemCleanWorktree',
  'companyWorkItemCloudPush',
  'companyWorkItemCloudPull',
  'companyCloudIssueClose',
  'companySquadSettingsSet',
  'companySquadRequest',
  'companySquadApprove',
  'companySquadDismiss',
  'companySquadCancel',
  'companySquadRemove',
  'companySquadRetry',
  'companySquadReply',
  'companySquadClose',
  'companySquadClaudeCheck',
  'companyAgentRoleSet',
  ...FOLDER_COMMAND_TYPES,
  ...USAGE_COMMAND_TYPES,
  'companyViewMode',
  'terminalAttach',
  'terminalInput',
  'terminalResize',
  'terminalDetach',
]);

const READ_ONLY_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'companySnapshotRequest',
  'herdrRead',
  'herdrWatch',
  'herdrInfoRequest',
  'companyModelCatalogRequest',
  'companyArtifactRequest',
  'companyFileListRequest',
  'companyFileReadRequest',
  'companySessionLogRequest',
  'companySessionInfoRequest',
  'companyOmpSessionsRequest',
  'companyViewMode',
  ...USAGE_COMMAND_TYPES,
]);

/** Commands that create a session or a prompt. They have no id to find a folder by, so they must name one. */
const CREATION_COMMAND_TYPES: Readonly<Record<string, true>> = {
  companyChatNew: true,
  companySessionResume: true,
  companyPromptSubmit: true,
  companyWorkItemCreate: true,
  companyWorkItemAssign: true,
  companyWorkItemFollowUp: true,
  companyWorkItemMark: true,
  companyWorkItemCancel: true,
  companyWorkItemDependencies: true,
  companyWorkItemJudge: true,
  companyWorkItemCleanWorktree: true,
  companyWorkItemCloudPush: true,
  companyWorkItemCloudPull: true,
  companyCloudIssueClose: true,
  companySquadSettingsSet: true,
  companySquadRequest: true,
  companySquadApprove: true,
  companySquadDismiss: true,
  companySquadCancel: true,
  companySquadRemove: true,
  companySquadRetry: true,
  companySquadReply: true,
  companySquadClose: true,
  companySquadClaudeCheck: true,
  companyAgentRoleSet: true,
};

export function isCompanyCommand(msg: Record<string, unknown>): boolean {
  return typeof msg.type === 'string' && COMPANY_COMMAND_TYPES.has(msg.type);
}

function requestIdOf(msg: Record<string, unknown>): string | null {
  if (typeof msg.requestId === 'string') return msg.requestId;
  const nested = msg.prompt ?? msg.answer;
  if (nested && typeof nested === 'object' && 'requestId' in nested) {
    const inner = (nested as { requestId?: unknown }).requestId;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

function stringField(msg: Record<string, unknown>, key: string): string | null {
  const value = msg[key];
  return typeof value === 'string' ? value : null;
}

function numberField(msg: Record<string, unknown>, key: string): number | null {
  const value = msg[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectField(msg: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = msg[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fail(send: Send, requestId: string | null, code: string, message?: string): void {
  send({
    type: 'companyCommandResult',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    ok: false,
    errorCode: code,
    ...(message === undefined ? {} : { message }),
  });
}

function ok(
  send: Send,
  requestId: string | null,
  revision?: number,
  sessionId?: string,
  workItemId?: string,
): void {
  send({
    type: 'companyCommandResult',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    ok: true,
    ...(revision === undefined ? {} : { revision }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(workItemId === undefined ? {} : { workItemId }),
  });
}

/**
 * Placeholder correlation id for the few commands that legitimately carry none
 * (terminal input/resize/detach). It is a real UUID so the wire schema holds,
 * and the UI ignores correlation for streamed input.
 */
const FALLBACK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';

/** Error code carried by a thrown coordinator/store rejection, when present. */
function codeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'company_command_failed';
}

function messageOf(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

/**
 * Dispatch one Company command. Returns true when the message was a company
 * command (handled or refused), false when it belongs to another dispatcher.
 */
export function handleCompanyCommand(
  msg: Record<string, unknown>,
  send: Send,
  ctx: CompanyCommandContext,
): boolean {
  if (!isCompanyCommand(msg)) return false;

  const requestId = requestIdOf(msg);

  if (ctx.privileged !== true) {
    fail(send, requestId, 'forbidden', 'Kết nối này không được phép chạy lệnh công ty.');
    return true;
  }
  if (ctx.executionAllowed !== true && !READ_ONLY_COMMAND_TYPES.has(String(msg.type))) {
    fail(
      send,
      requestId,
      'workspace_untrusted',
      'Hãy tin cậy workspace này trước khi chạy lệnh công ty.',
    );
    return true;
  }
  if (USAGE_COMMAND_TYPES.has(String(msg.type))) {
    void usageCommand(msg, requestId, ctx.usage ?? null, send);
    return true;
  }

  if (msg.type === 'companySnapshotRequest') {
    send(ctx.herdr?.snapshot() ?? HERDR_NOT_LINKED_ROSTER);
  }
  if (msg.type === 'companySnapshotRequest' && ctx.browserReaper) {
    send(ctx.browserReaper.snapshot());
  }
  if (msg.type === 'companySnapshotRequest' && ctx.workspaces) {
    send({ type: 'companyWorkspaces', workspaces: ctx.workspaces.entries() });
  }
  if (HERDR_COMMAND_TYPES.has(String(msg.type))) {
    void herdrCommand(msg, requestId, ctx.herdr ?? null, send);
    return true;
  }
  if (msg.type === 'companyWorkspaceOpen') {
    void openWorkspace(requestId, stringField(msg, 'path'), ctx.workspaces ?? null, send);
    return true;
  }
  if (FOLDER_COMMAND_TYPES.has(String(msg.type))) {
    void folderCommand(msg, requestId, ctx.workspaces ?? null, send);
    return true;
  }
  if (msg.type === 'companyViewMode') {
    setViewMode(msg, requestId, ctx, send);
    return true;
  }
  if (ctx.workspaces) {
    void routeAndRun(msg, requestId, ctx.workspaces, send, ctx);
    return true;
  }
  const services = ctx.services;
  if (!services) {
    fail(send, requestId, 'company_unavailable', 'Chưa mở workspace công ty nào.');
    return true;
  }

  void run(msg, requestId, services, send, ctx);
  return true;
}

async function run(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
  ctx: CompanyCommandContext,
): Promise<void> {
  try {
    switch (msg.type) {
      case 'companySnapshotRequest':
        await snapshot(msg, requestId, services, send);
        return;
      case 'companyPromptSubmit':
        await submitPrompt(msg, services, send);
        return;
      case 'companyContractDecision':
        await decideContract(msg, requestId, services, send);
        return;
      case 'companyQuestionAnswer':
        await answerQuestion(msg, services, send);
        return;
      case 'companySessionControl':
        await controlSession(msg, requestId, services, send);
        return;
      case 'companySessionRename':
        await renameSession(msg, requestId, services, send);
        return;
      case 'companySessionInfoRequest':
        await sessionInfo(msg, requestId, services, send);
        return;
      case 'companyPromptCancel':
        await cancelPrompt(msg, requestId, services, send);
        return;
      case 'companyOmpSessionsRequest':
        await listOmpSessions(requestId, services, send);
        return;
      case 'companySessionResume':
        await resumeOmpSession(msg, requestId, services, send);
        return;
      case 'companyChatNew':
        await chatNew(requestId, services, send);
        return;
      case 'companySettingsUpdate':
        await updateSettings(msg, requestId, services, send);
        return;
      case 'companyModelCatalogRequest':
        await modelCatalog(requestId, services, send);
        return;
      case 'companyArtifactRequest':
        await artifactPage(msg, requestId, services, send);
        return;
      case 'companyFileListRequest':
        await fileList(msg, requestId, services, send);
        return;
      case 'companyFileReadRequest':
        await fileRead(msg, requestId, services, send);
        return;
      case 'companySessionLogRequest':
        await sessionLogPage(msg, requestId, services, send);
        return;
      case 'companyAttachmentUpload':
        await attachmentUpload(msg, requestId, services, send);
        return;
      case 'companyWorkItemCreate':
      case 'companyWorkItemAssign':
      case 'companyWorkItemFollowUp':
      case 'companyWorkItemMark':
      case 'companyWorkItemCancel':
      case 'companyWorkItemDependencies':
      case 'companyWorkItemJudge':
      case 'companyWorkItemCleanWorktree':
      case 'companyWorkItemCloudPush':
      case 'companyWorkItemCloudPull':
      case 'companyCloudIssueClose':
      case 'companySquadSettingsSet':
      case 'companySquadClaudeCheck':
      case 'companyAgentRoleSet':
        await workItemCommand(msg, requestId, services, send);
        return;
      case 'companySquadRequest':
      case 'companySquadApprove':
      case 'companySquadDismiss':
      case 'companySquadCancel':
      case 'companySquadRemove':
      case 'companySquadRetry':
      case 'companySquadReply':
      case 'companySquadClose':
        await squadCommand(msg, requestId, services, send);
        return;
      case 'terminalAttach':
        await terminalAttach(msg, requestId, services, send, ctx);
        return;
      case 'terminalInput':
        await terminalInput(msg, requestId, services, send);
        return;
      case 'terminalResize':
        await terminalResize(msg, requestId, services, send);
        return;
      case 'terminalDetach':
        await terminalDetach(msg, requestId, services, send, ctx);
        return;
      default:
        fail(send, requestId, 'company_unsupported_command', `Không hỗ trợ: ${String(msg.type)}`);
    }
  } catch (err) {
    fail(send, requestId, codeOf(err), messageOf(err));
  }
}

/** Herdr runs on the server-level link, so these commands need no company workspace. */
async function herdrCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  herdr: HerdrLink | null,
  send: Send,
): Promise<void> {
  if (requestId === null) {
    fail(send, null, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
    return;
  }
  if (herdr === null) {
    fail(send, requestId, 'herdr_unavailable', HERDR_NOT_LINKED_MESSAGE);
    return;
  }
  const paneId = stringField(msg, 'paneId');
  if (paneId === null) {
    fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
    return;
  }
  try {
    switch (msg.type) {
      case 'herdrRead': {
        const lines = msg.lines === undefined ? HERDR_DEFAULT_READ_LINES : numberField(msg, 'lines');
        if (lines === null) {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        send({ ...(await herdr.read(paneId, lines)), requestId });
        return;
      }
      case 'herdrPrompt': {
        const text = stringField(msg, 'text');
        if (text === null) {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        await herdr.prompt(paneId, text);
        ok(send, requestId);
        return;
      }
      case 'herdrKeys': {
        const keys = Array.isArray(msg.keys) && msg.keys.every(isHerdrKey) ? msg.keys : null;
        if (keys === null) {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        await herdr.keys(paneId, keys);
        ok(send, requestId);
        return;
      }
      case 'herdrFocus':
        await herdr.focus(paneId);
        ok(send, requestId);
        return;
      case 'herdrClose':
        await herdr.close(paneId);
        ok(send, requestId);
        return;
      case 'herdrWake': {
        const prompt = msg.prompt === undefined ? undefined : stringField(msg, 'prompt');
        if (prompt === null) {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        // The pane the session runs in now: the board opens its screen.
        const paneNow = await herdr.wake(paneId, prompt);
        send({ type: 'companyCommandResult', requestId: requestId ?? FALLBACK_REQUEST_ID, ok: true, paneId: paneNow });
        return;
      }
      case 'herdrWatch': {
        const watching = msg.watching;
        if (typeof watching !== 'boolean') {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        herdr.watch(paneId, watching);
        ok(send, requestId);
        return;
      }
      case 'herdrRename': {
        const name = stringField(msg, 'name');
        if (name === null) {
          fail(send, requestId, 'invalid_request', INVALID_HERDR_REQUEST_MESSAGE);
          return;
        }
        await herdr.rename(paneId, name);
        ok(send, requestId);
        return;
      }
      case 'herdrInfoRequest':
        send({ type: 'herdrInfo', requestId, paneId, info: await herdr.info(paneId) });
        return;
      default:
        fail(send, requestId, 'company_unsupported_command', `Không hỗ trợ: ${String(msg.type)}`);
    }
  } catch (err) {
    if (err instanceof HerdrError) fail(send, requestId, err.code, err.message);
    else fail(send, requestId, 'herdr_failed', HERDR_FAILED_MESSAGE);
  }
}

/**
 * Open or switch to a Company folder. The folder list answers the refusal, so a
 * missing path or a file reaches the user with its own Vietnamese message.
 */
async function openWorkspace(
  requestId: string | null,
  workspacePath: string | null,
  workspaces: CompanyWorkspaceControl | null,
  send: Send,
): Promise<void> {
  if (workspaces === null) {
    fail(send, requestId, 'company_unavailable', 'Máy chủ này không quản lý nhiều thư mục.');
    return;
  }
  if (workspacePath === null) {
    fail(send, requestId, 'invalid_request', 'Cần đường dẫn thư mục để mở.');
    return;
  }
  try {
    await workspaces.open(workspacePath);
    ok(send, requestId);
  } catch (err) {
    fail(send, requestId, codeOf(err), messageOf(err));
  }
}

const INVALID_USAGE_REQUEST_MESSAGE = 'Yêu cầu đọc sử dụng token không hợp lệ.';

/**
 * The usage page reads: account limits, recorded limit history, and the stats roll-up. Answered from the
 * usage reader's cache; they need no open workspace, so they run before routing.
 */
async function usageCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  usage: UsageControl | null,
  send: Send,
): Promise<void> {
  if (requestId === null) {
    fail(send, null, 'invalid_request', INVALID_USAGE_REQUEST_MESSAGE);
    return;
  }
  if (msg.force !== undefined && typeof msg.force !== 'boolean') {
    fail(send, requestId, 'invalid_request', INVALID_USAGE_REQUEST_MESSAGE);
    return;
  }
  if (usage === null) {
    fail(send, requestId, 'usage_unavailable', 'Máy chủ này chưa bật đọc sử dụng token.');
    return;
  }
  const force = msg.force === true;
  try {
    if (msg.type === 'usageLimitsRequest') {
      send({ type: 'usageLimits', requestId, ...(await usage.limits(force)) });
    } else if (msg.type === 'usageHistoryRequest') {
      const days = msg.days;
      if (days !== 1 && days !== 7 && days !== 30) {
        fail(send, requestId, 'invalid_request', INVALID_USAGE_REQUEST_MESSAGE);
        return;
      }
      send({ type: 'usageHistory', requestId, ...(await usage.history(days, force)) });
    } else {
      send({ type: 'usageStats', requestId, ...(await usage.stats(force)) });
    }
  } catch (err) {
    fail(send, requestId, codeOf(err), messageOf(err));
  }
}

/**
 * Folder picking, folder naming and forgetting. They answer for the folder list rather than for one folder's
 * services, so they run before routing: a pick needs no open folder.
 */
async function folderCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  workspaces: CompanyWorkspaceControl | null,
  send: Send,
): Promise<void> {
  try {
    if (msg.type === 'companyFolderPick') {
      await pickFolderCommand(requestId, send);
    } else if (msg.type === 'companyFolderForget') {
      await forgetFolderCommand(msg, requestId, workspaces, send);
    } else {
      await nameFolderCommand(msg, requestId, workspaces, send);
    }
  } catch (err) {
    fail(send, requestId, codeOf(err), messageOf(err));
  }
}

/** Open Windows' folder dialog on the board's machine; the verdict names the folder chosen, or none on cancel. */
async function pickFolderCommand(requestId: string | null, send: Send): Promise<void> {
  const chosen = await pickFolder();
  send({
    type: 'companyCommandResult',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    ok: true,
    ...(chosen === null ? {} : { workspacePath: chosen }),
  });
}

/** Store or clear a folder's display name, then answer with the folder's canonical path. */
async function nameFolderCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  workspaces: CompanyWorkspaceControl | null,
  send: Send,
): Promise<void> {
  const folderPath = stringField(msg, 'path');
  const name = stringField(msg, 'name');
  if (folderPath === null || name === null) {
    fail(send, requestId, 'invalid_request', 'Cần đường dẫn và tên thư mục.');
    return;
  }
  if (workspaces === null) {
    fail(send, requestId, 'company_unavailable', 'Máy chủ này không quản lý nhiều thư mục.');
    return;
  }
  const canonical = await resolveFolderPath(folderPath);
  workspaces.setFolderName(canonical, name.trim().length === 0 ? null : name);
  send({
    type: 'companyCommandResult',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    ok: true,
    workspacePath: canonical,
  });
}

/** Take a folder off the list, stopping its Company when it is open. The path is taken as listed. */
async function forgetFolderCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  workspaces: CompanyWorkspaceControl | null,
  send: Send,
): Promise<void> {
  const folderPath = stringField(msg, 'path');
  if (folderPath === null || folderPath.trim() === '') {
    fail(send, requestId, 'invalid_request', 'Cần đường dẫn thư mục để gỡ.');
    return;
  }
  if (workspaces === null) {
    fail(send, requestId, 'company_unavailable', 'Máy chủ này không quản lý nhiều thư mục.');
    return;
  }
  await workspaces.forget(folderPath);
  ok(send, requestId);
}

/**
 * Run a command against the folder it routes to. Snapshot requests answer for one, several or
 * the active folder, so they are answered on their own.
 */
async function routeAndRun(
  msg: Record<string, unknown>,
  requestId: string | null,
  workspaces: CompanyWorkspaceControl,
  send: Send,
  ctx: CompanyCommandContext,
): Promise<void> {
  try {
    if (msg.type === 'companySnapshotRequest') {
      await answerSnapshotRequest(msg, requestId, workspaces, send, ctx);
      return;
    }
    const services = await resolveServices(msg, workspaces);
    if (!services) {
      fail(send, requestId, 'company_unavailable', 'Chưa mở workspace công ty nào.');
      return;
    }
    await run(msg, requestId, services, send, ctx);
  } catch (err) {
    fail(send, requestId, codeOf(err), messageOf(err));
  }
}

/**
 * The folder a command runs against: the folder it names; otherwise the folder holding the id it
 * acts on, falling back to the active folder so the handler gives its own not-found answer;
 * otherwise the active folder. A creation command has no id to find a folder by, so without a
 * named folder it is refused.
 */
async function resolveServices(
  msg: Record<string, unknown>,
  workspaces: CompanyWorkspaceControl,
): Promise<CompanyCommandServices | null> {
  const workspacePath = stringField(msg, 'workspacePath');
  if (workspacePath !== null) return workspaces.ensure(workspacePath);
  const routedId = routedIdOf(msg);
  if (routedId) return workspaces.servicesHolding(routedId) ?? workspaces.activeServices();
  if (CREATION_COMMAND_TYPES[String(msg.type)] === true) {
    throw new CompanyError('workspace_required', 'Chọn thư mục để thực hiện thao tác này.');
  }
  return workspaces.activeServices();
}

/**
 * The id a command acts on, when it is bound to one. A prompt names a session only when it
 * targets one; a prompt with no target creates a session instead.
 */
function routedIdOf(msg: Record<string, unknown>): string | null {
  switch (msg.type) {
    case 'companyContractDecision':
      return stringField(msg, 'contractId');
    case 'companyPromptCancel':
      return stringField(msg, 'promptId');
    case 'companyQuestionAnswer':
      return stringField(objectField(msg, 'answer') ?? {}, 'questionId');
    case 'companyPromptSubmit':
      return stringField(objectField(msg, 'prompt') ?? {}, 'targetSessionId');
    case 'companySessionControl':
    case 'companySessionRename':
    case 'companySessionInfoRequest':
    case 'companySessionLogRequest':
    case 'terminalAttach':
    case 'terminalInput':
    case 'terminalResize':
    case 'terminalDetach':
      return stringField(msg, 'sessionId');
    default:
      return null;
  }
}

/**
 * Answer a snapshot request for the folder it names. Without one, an `all` view gets one snapshot
 * per open folder and any other view gets the active folder's.
 */
async function answerSnapshotRequest(
  msg: Record<string, unknown>,
  requestId: string | null,
  workspaces: CompanyWorkspaceControl,
  send: Send,
  ctx: CompanyCommandContext,
): Promise<void> {
  const workspacePath = stringField(msg, 'workspacePath');
  if (workspacePath !== null) {
    const services = workspaces.servicesFor(workspacePath);
    if (!services) {
      fail(send, requestId, 'workspace_not_open', 'Thư mục này chưa được mở.');
      return;
    }
    await snapshot(msg, requestId, services, send);
    return;
  }
  if (ctx.companyViewMode?.() === 'all') {
    let answered = 0;
    for (const entry of workspaces.entries()) {
      const services = entry.open ? workspaces.servicesFor(entry.path) : null;
      if (!services) continue;
      await snapshot(msg, requestId, services, send);
      answered += 1;
    }
    if (answered === 0) {
      fail(send, requestId, 'company_unavailable', 'Chưa mở workspace công ty nào.');
    }
    return;
  }
  const services = workspaces.activeServices();
  if (!services) {
    fail(send, requestId, 'company_unavailable', 'Chưa mở workspace công ty nào.');
    return;
  }
  await snapshot(msg, requestId, services, send);
}

/**
 * Record the connection's company view. Only the view changes: the client asks for the snapshot
 * it needs next, so no snapshot is sent here.
 */
function setViewMode(
  msg: Record<string, unknown>,
  requestId: string | null,
  ctx: CompanyCommandContext,
  send: Send,
): void {
  const mode = stringField(msg, 'mode');
  if (mode !== 'all' && mode !== 'folder') {
    fail(send, requestId, 'invalid_request', 'Chế độ xem phải là all hoặc folder.');
    return;
  }
  ctx.onCompanyViewMode?.(mode);
  ok(send, requestId);
}

async function snapshot(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const includeDiagnostics = msg.includeDiagnostics === true;
  const projection = services.coordinator.snapshot();
  const diagnostics = includeDiagnostics ? services.coordinator.diagnostics() : undefined;
  send({
    type: 'companySnapshot',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    snapshot: diagnostics ? { ...projection, diagnostics } : projection,
    workspacePath: services.workspaceRoot,
  });
  if (services.workItems) send(services.workItems.snapshot());
  if (services.squad) send(services.squad.snapshot());
}

async function submitPrompt(
  msg: Record<string, unknown>,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const prompt = objectField(msg, 'prompt');
  const text = prompt ? stringField(prompt, 'text') : null;
  const delivery = prompt ? stringField(prompt, 'delivery') : null;
  if (!prompt || text === null || delivery === null || !isPromptDelivery(delivery)) {
    fail(send, requestIdOf(msg), 'invalid_prompt', 'Cần có nội dung prompt và cách gửi.');
    return;
  }
  const mode = stringField(prompt, 'mode');
  if (mode !== null && mode !== 'chat' && mode !== 'company') {
    fail(send, requestIdOf(msg), 'invalid_prompt', 'Chế độ prompt phải là chat hoặc company.');
    return;
  }
  const requestId = stringField(prompt, 'requestId') ?? requestIdOf(msg);
  // Checked on the raw bytes, before decoding, so a truncated prompt is never
  // submitted as a valid shorter one.
  if (Buffer.byteLength(text, 'utf-8') > COMPANY_MAX_PROMPT_BYTES) {
    fail(send, requestId, 'prompt_too_large', `Prompt vượt quá ${COMPANY_MAX_PROMPT_BYTES} byte.`);
    return;
  }
  const stored = await services.coordinator.submitPrompt(prompt as unknown as SubmitPromptInput);
  ok(send, requestId, undefined, stored.targetSessionId);
}

async function decideContract(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const contractId = stringField(msg, 'contractId');
  const revision = numberField(msg, 'revision');
  const decision = stringField(msg, 'decision');
  if (!contractId || revision === null || !decision || !isContractDecision(decision)) {
    fail(
      send,
      requestId,
      'invalid_contract_decision',
      'Cần có id hợp đồng, revision và quyết định.',
    );
    return;
  }
  const note = stringField(msg, 'note') ?? undefined;
  await services.coordinator.decideContract(contractId, revision, decision, note);
  ok(send, requestId);
}

async function answerQuestion(
  msg: Record<string, unknown>,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const answer = objectField(msg, 'answer');
  if (!answer) {
    fail(send, requestIdOf(msg), 'invalid_answer', 'Cần có payload trả lời.');
    return;
  }
  await services.coordinator.answerQuestion(answer as unknown as QuestionAnswerInput);
  ok(send, stringField(answer, 'requestId') ?? requestIdOf(msg));
}

async function renameSession(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const name = (stringField(msg, 'name') ?? '').trim();
  if (
    sessionId === null ||
    !isSessionLogId(sessionId) ||
    name.length === 0 ||
    name.length > COMPANY_SESSION_NAME_MAX_LENGTH
  ) {
    fail(
      send,
      requestId,
      'invalid_session_rename',
      `Cần có sessionId hợp lệ và tên từ 1 đến ${COMPANY_SESSION_NAME_MAX_LENGTH} ký tự.`,
    );
    return;
  }
  await services.coordinator.renameSession(sessionId, name);
  ok(send, requestId);
}

async function sessionInfo(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  if (sessionId === null || !isSessionLogId(sessionId)) {
    fail(send, requestId, 'invalid_session_info_request', 'Cần có sessionId hợp lệ.');
    return;
  }
  const info = await services.sessionInfo(sessionId);
  send({
    type: 'companySessionInfo',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    sessionId,
    info,
  });
}

async function controlSession(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const runEpoch = numberField(msg, 'runEpoch');
  const action = stringField(msg, 'action');
  if (!sessionId || runEpoch === null || !action || !isSessionAction(action)) {
    fail(send, requestId, 'invalid_session_control', 'Cần có id phiên, run epoch và hành động.');
    return;
  }
  await services.coordinator.controlSession(sessionId, action as CompanySessionAction, runEpoch);
  ok(send, requestId);
}

async function cancelPrompt(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const promptId = stringField(msg, 'promptId');
  if (promptId === null || promptId.length === 0) {
    fail(send, requestId, 'invalid_prompt_cancel', 'Cần có id prompt.');
    return;
  }
  await services.coordinator.cancelPrompt(promptId);
  ok(send, requestId);
}

/** The item fields a create or an assign carries. Null when one of them is present but malformed. */
type ItemFields = Pick<WorkItemDraft, 'repo' | 'role' | 'areas' | 'agent'>;

function itemFields(msg: Record<string, unknown>): ItemFields | null {
  const { repo, role, areas, agent } = msg;
  if (repo !== undefined && typeof repo !== 'string') return null;
  if (agent !== undefined && typeof agent !== 'string') return null;
  if (areas !== undefined && !isStringArray(areas)) return null;
  if (role !== undefined && (typeof role !== 'string' || !isItemRole(role))) return null;
  return {
    ...(repo === undefined ? {} : { repo }),
    ...(role === undefined ? {} : { role }),
    ...(areas === undefined ? {} : { areas }),
    ...(agent === undefined ? {} : { agent }),
  };
}

/** The optional fields a create carries. Null when one of them is present but malformed. */
function createFields(
  msg: Record<string, unknown>,
): (Pick<WorkItemDraft, 'priority' | 'acceptance' | 'dependsOn'> & ItemFields) | null {
  const { priority, acceptance, dependsOn } = msg;
  if (priority !== undefined && !isWorkItemPriority(priority)) return null;
  if (acceptance !== undefined && typeof acceptance !== 'string') return null;
  if (dependsOn !== undefined && !isStringArray(dependsOn)) return null;
  const fields = itemFields(msg);
  if (fields === null) return null;
  return {
    ...fields,
    ...(priority === undefined ? {} : { priority }),
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(dependsOn === undefined ? {} : { dependsOn }),
  };
}

/** Whether a value is a list of strings, such as a wait list of ids. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Work item commands. The folder's work item service applies each one, and a reply carries the id
 * of the item a create made. A resent command gets the same answer: the service remembers request ids.
 */
async function workItemCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const work = services.workItems;
  if (!work) {
    fail(send, requestId, 'company_unavailable', 'Thư mục này chưa sẵn sàng để giao việc.');
    return;
  }
  if (requestId === null) {
    fail(send, requestId, 'invalid_request', 'Cần có requestId.');
    return;
  }
  const id = stringField(msg, 'id') ?? '';
  if (msg.type === 'companyWorkItemCreate') {
    if (!isWorkItemAssignee(msg.assignee)) {
      fail(send, requestId, 'assignee_invalid', 'Người nhận việc không hợp lệ.');
      return;
    }
    const fields = createFields(msg);
    if (fields === null) {
      fail(send, requestId, 'invalid_request', 'Thông tin việc không hợp lệ.');
      return;
    }
    const workItemId = await work.create({
      requestId,
      text: stringField(msg, 'text') ?? '',
      assignee: msg.assignee,
      ...fields,
    });
    ok(send, requestId, undefined, undefined, workItemId);
    return;
  }
  if (msg.type === 'companyWorkItemAssign') {
    if (!isWorkItemAssignee(msg.assignee)) {
      fail(send, requestId, 'assignee_invalid', 'Người nhận việc không hợp lệ.');
      return;
    }
    const fields = itemFields(msg);
    if (fields === null) {
      fail(send, requestId, 'invalid_request', 'Thông tin việc không hợp lệ.');
      return;
    }
    await work.assign({ requestId, id, assignee: msg.assignee, ...fields });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemFollowUp') {
    await work.followUp({ requestId, id, text: stringField(msg, 'text') ?? '' });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemMark') {
    const verdict = stringField(msg, 'verdict');
    if (verdict !== 'done' && verdict !== 'failed') {
      fail(send, requestId, 'invalid_work_item_verdict', 'Kết quả phải là done hoặc failed.');
      return;
    }
    await work.mark({ requestId, id, verdict });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemJudge') {
    await work.judgeAgain({ requestId, id });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemCleanWorktree') {
    await work.cleanWorktree({ requestId, id });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemCloudPush') {
    await work.pushToCloud({ requestId, id });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemCloudPull') {
    await work.pullCloud({ requestId, id });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyCloudIssueClose') {
    if (typeof msg.issue !== 'number' || !Number.isSafeInteger(msg.issue) || msg.issue < 1) {
      fail(send, requestId, 'invalid_request', 'Số Issue không hợp lệ.');
      return;
    }
    await work.closeCloudIssue({ requestId, issue: msg.issue });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemCancel') {
    await work.cancel({ requestId, id, keepWorktree: msg.keepWorktree === true });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companyWorkItemDependencies') {
    const dependsOn = msg.dependsOn;
    if (!isStringArray(dependsOn)) {
      fail(send, requestId, 'invalid_request', 'Danh sách việc chờ không hợp lệ.');
      return;
    }
    await work.setDependencies({ requestId, id, dependsOn });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadSettingsSet') {
    if (!isSquadSettings(msg.settings)) {
      fail(send, requestId, 'settings_invalid', 'Cài đặt đội không hợp lệ.');
      return;
    }
    await work.setSettings({ requestId, settings: msg.settings });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadClaudeCheck') {
    await work.checkClaude();
    ok(send, requestId);
    return;
  }
  if (!isWorkItemAssignee(msg.agent)) {
    fail(send, requestId, 'assignee_invalid', 'Người nhận việc không hợp lệ.');
    return;
  }
  await work.setRole({
    requestId,
    agent: msg.agent,
    description: stringField(msg, 'description') ?? '',
  });
  ok(send, requestId);
}

/**
 * Squad commands. The folder's squad service applies each one; a resent command gets the same
 * answer. A request replies with the run it started, so the board can open that run.
 */
async function squadCommand(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const squad = services.squad;
  if (!squad) {
    fail(send, requestId, 'company_unavailable', 'Thư mục này chưa sẵn sàng để giao cho đội.');
    return;
  }
  if (requestId === null) {
    fail(send, requestId, 'invalid_request', 'Cần có requestId.');
    return;
  }
  if (msg.type === 'companySquadRequest') {
    const fromWorkItemId = stringField(msg, 'fromWorkItemId') ?? undefined;
    const started = await squad.request(
      fromWorkItemId === undefined
        ? { requestId, text: stringField(msg, 'text') ?? '' }
        : { requestId, fromWorkItemId },
    );
    send({ type: 'companyCommandResult', requestId, ok: true, squadRunId: started });
    return;
  }
  const runId = stringField(msg, 'runId') ?? '';
  if (msg.type === 'companySquadApprove') {
    await squad.approve({
      requestId,
      runId,
      proposalId: stringField(msg, 'proposalId') ?? '',
      rows: msg.rows,
    });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadDismiss') {
    await squad.dismiss({ requestId, runId, proposalId: stringField(msg, 'proposalId') ?? '' });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadCancel') {
    await squad.cancel({ requestId, runId });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadRemove') {
    await squad.remove({ requestId, runId });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadReply') {
    await squad.reply({ requestId, runId, text: stringField(msg, 'text') ?? '' });
    ok(send, requestId);
    return;
  }
  if (msg.type === 'companySquadClose') {
    await squad.close({ requestId, runId });
    ok(send, requestId);
    return;
  }
  await squad.retry({ requestId, runId });
  ok(send, requestId);
}

async function listOmpSessions(
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const listing = await services.coordinator.listOmpSessions();
  send({
    type: 'companyOmpSessions',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    folder: listing.folder,
    sessions: listing.sessions,
  });
}

async function resumeOmpSession(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const file = stringField(msg, 'file');
  if (file === null || file.length === 0) {
    fail(send, requestId, 'invalid_session_resume', 'Cần có đường dẫn file phiên OMP.');
    return;
  }
  const sessionId = await services.coordinator.resumeOmpSession(file);
  ok(send, requestId, undefined, sessionId);
}

async function chatNew(
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = await services.coordinator.openNewChat();
  ok(send, requestId, undefined, sessionId);
}

async function updateSettings(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const roleProfiles = objectField(msg, 'roleProfiles');
  if (!roleProfiles) {
    fail(send, requestId, 'invalid_settings', 'Cần có roleProfiles.');
    return;
  }
  await services.coordinator.updateSettings(roleProfiles as Record<string, RoleProfile>);
  ok(send, requestId);
}

async function modelCatalog(
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const entries = await services.modelCatalog();
  send({
    type: 'companyModelCatalog',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    entries,
  });
}

async function artifactPage(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const artifactId = stringField(msg, 'artifactId');
  const offset = numberField(msg, 'offset') ?? 0;
  const limit = Math.min(
    numberField(msg, 'limit') ?? COMPANY_ARTIFACT_PAGE_BYTES,
    COMPANY_ARTIFACT_PAGE_BYTES,
  );
  if (!artifactId) {
    fail(send, requestId, 'invalid_artifact_id', 'Cần có artifactId.');
    return;
  }
  const page = await services.store.readArtifact(artifactId, offset, limit);
  send({ type: 'companyArtifactPage', requestId: requestId ?? FALLBACK_REQUEST_ID, page });
}

async function fileList(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const requested = stringField(msg, 'path');
  if (requested === null) {
    fail(send, requestId, 'invalid_path', 'Cần có đường dẫn tương đối so với workspace.');
    return;
  }
  const entries = await listWorkspaceFiles(services.workspaceRoot, requested);
  send({
    type: 'companyFileList',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    path: requested,
    entries,
  });
}

async function fileRead(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const requested = stringField(msg, 'path');
  if (requested === null) {
    fail(send, requestId, 'invalid_path', 'Cần có đường dẫn tương đối so với workspace.');
    return;
  }
  const offset = numberField(msg, 'offset') ?? 0;
  const limit = numberField(msg, 'limit') ?? COMPANY_FILE_DEFAULT_PAGE_BYTES;
  const content = await readWorkspaceFile(services.workspaceRoot, requested, offset, limit);
  send({ type: 'companyFileRead', requestId: requestId ?? FALLBACK_REQUEST_ID, content });
}

async function sessionLogPage(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const limit = msg.limit === undefined ? SESSION_LOG_DEFAULT_LIMIT : numberField(msg, 'limit');
  if (
    sessionId === null ||
    !isSessionLogId(sessionId) ||
    limit === null ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SESSION_LOG_MAX_LIMIT
  ) {
    fail(
      send,
      requestId,
      'invalid_session_log_request',
      'Cần có sessionId hợp lệ và limit từ 1 đến 500.',
    );
    return;
  }
  const boardEntries = await readSessionLog(
    sessionLogDirectory(services.store.namespaceDir),
    sessionId,
    limit,
  );
  // A Claude Code run has no board log of its own: its transcript is the log.
  const entries =
    boardEntries.length > 0 ? boardEntries : await readClaudeTranscriptLog(sessionId, limit);
  send({
    type: 'companySessionLog',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    sessionId,
    replay: true,
    entries,
  });
}

async function attachmentUpload(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const fileName = stringField(msg, 'fileName');
  const mediaType = stringField(msg, 'mediaType');
  const dataBase64 = stringField(msg, 'dataBase64');
  if (!fileName || !mediaType || dataBase64 === null) {
    fail(send, requestId, 'invalid_attachment', 'Cần có fileName, mediaType và dataBase64.');
    return;
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  // Buffer.from silently drops invalid base64, so a payload that does not
  // round-trip is rejected rather than stored truncated.
  if (
    bytes.length === 0 ||
    bytes.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')
  ) {
    fail(send, requestId, 'invalid_attachment', 'Payload tệp đính kèm không phải base64 hợp lệ.');
    return;
  }
  if (bytes.length > COMPANY_ATTACHMENT_MAX_BYTES) {
    fail(send, requestId, 'attachment_too_large', 'Tệp đính kèm vượt quá hạn mức kích thước.');
    return;
  }
  const artifactId = await services.store.writeArtifact(bytes, mediaType);
  const attachment: PromptAttachment = {
    artifactId,
    fileName,
    mediaType,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  send({
    type: 'companyAttachmentUploaded',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    attachment,
  });
}

function requireTerminal(
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): CompanyTerminalGateway | null {
  if (services.terminal) return services.terminal;
  fail(send, requestId, 'terminal_unavailable', 'Chưa cài đặt khả năng terminal gốc.');
  return null;
}

async function terminalAttach(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
  ctx: CompanyCommandContext,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const runEpoch = numberField(msg, 'runEpoch');
  if (!sessionId || runEpoch === null) {
    fail(send, requestId, 'invalid_terminal_attach', 'Cần có sessionId và runEpoch.');
    return;
  }
  const terminal = requireTerminal(requestId, services, send);
  if (!terminal) return;
  const cols = numberField(msg, 'cols') ?? COMPANY_DEFAULT_TERMINAL_COLS;
  const rows = numberField(msg, 'rows') ?? COMPANY_DEFAULT_TERMINAL_ROWS;
  let notifiedLeaseId: string | null = null;
  const handle = await terminal.attach(sessionId, runEpoch, cols, rows, (leaseId) => {
    notifiedLeaseId = leaseId;
    ctx.onTerminalAttached?.(sessionId, leaseId);
  });
  if (notifiedLeaseId !== handle.leaseId) {
    ctx.onTerminalAttached?.(sessionId, handle.leaseId);
  }
  send({
    type: 'terminalAttached',
    requestId: requestId ?? FALLBACK_REQUEST_ID,
    sessionId,
    runEpoch,
    leaseId: handle.leaseId,
    cols: handle.cols,
    rows: handle.rows,
  });
  // Sent in the same turn as the attach reply: no live frame can arrive between them.
  if (handle.replay) {
    send({ type: 'terminalSnapshot', sessionId, runEpoch, ...handle.replay });
  }
}

async function terminalInput(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const runEpoch = numberField(msg, 'runEpoch');
  const data = stringField(msg, 'data');
  const leaseId = stringField(msg, 'leaseId');
  if (!sessionId || runEpoch === null || data === null || !leaseId) {
    fail(
      send,
      requestId,
      'invalid_terminal_input',
      'Cần có sessionId, runEpoch, data và leaseId.',
    );
    return;
  }
  if (Buffer.byteLength(data, 'utf-8') > COMPANY_TERMINAL_INPUT_MAX_BYTES) {
    fail(
      send,
      requestId,
      'terminal_input_too_large',
      `Chunk input vượt quá ${COMPANY_TERMINAL_INPUT_MAX_BYTES} byte.`,
    );
    return;
  }
  const terminal = requireTerminal(requestId, services, send);
  if (!terminal) return;
  await terminal.write(sessionId, runEpoch, data, leaseId);
  ok(send, requestId);
}

async function terminalResize(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const runEpoch = numberField(msg, 'runEpoch');
  const cols = numberField(msg, 'cols');
  const rows = numberField(msg, 'rows');
  const leaseId = stringField(msg, 'leaseId');
  if (!sessionId || runEpoch === null || cols === null || rows === null || !leaseId) {
    fail(
      send,
      requestId,
      'invalid_terminal_resize',
      'Cần có sessionId, runEpoch, cols, rows và leaseId.',
    );
    return;
  }
  const terminal = requireTerminal(requestId, services, send);
  if (!terminal) return;
  await terminal.resize(sessionId, runEpoch, cols, rows, leaseId);
  ok(send, requestId);
}

async function terminalDetach(
  msg: Record<string, unknown>,
  requestId: string | null,
  services: CompanyCommandServices,
  send: Send,
  ctx: CompanyCommandContext,
): Promise<void> {
  const sessionId = stringField(msg, 'sessionId');
  const runEpoch = numberField(msg, 'runEpoch');
  const leaseId = stringField(msg, 'leaseId');
  if (!sessionId || runEpoch === null || !leaseId) {
    fail(
      send,
      requestId,
      'invalid_terminal_detach',
      'Cần có sessionId, runEpoch và leaseId.',
    );
    return;
  }
  const terminal = requireTerminal(requestId, services, send);
  if (!terminal) return;
  await terminal.detach(sessionId, runEpoch, leaseId);
  ctx.onTerminalDetached?.(sessionId, leaseId);
  ok(send, requestId);
}
