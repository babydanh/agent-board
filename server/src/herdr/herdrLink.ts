import * as childProcess from 'node:child_process';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import type { BoardAgentEngine, HerdrAgentEngine } from '../../../core/src/agentEngines.js';
import type {
  AgentInfo as BoardAgentInfo,
  HerdrAgent,
  HerdrAgentsMessage,
  HerdrKey,
  HerdrScreenMessage,
  HerdrSleepingSession,
} from '../../../core/src/messages.js';
import { jsonField } from './jsonField.js';
import {
  OMP_TAIL_BYTES,
  ompAgentFields,
  type OmpTranscriptSummary,
  readOmpTranscript,
} from './ompTranscript.js';
import { isHerdrPaneId } from './paneId.js';
import { screenDigest } from './screenDigest.js';
import {
  type ClosedSleepWake,
  type PaneFact,
  type SleepDropReason,
  type SleepingSession,
  SleepRegistry,
} from './sleepingSessions.js';

/** Protocol generation this board speaks; herdr reports it in `ping`. */
export const HERDR_PROTOCOL_VERSION = 22;

export const HERDR_DEFAULT_READ_LINES = 200;
export const HERDR_MAX_READ_LINES = 2000;
export const HERDR_MAX_KEYS = 16;
export const HERDR_PROMPT_MAX_BYTES = 32 * 1024;

const HERDR_KEY_SET: Record<HerdrKey, true> = {
  up: true,
  down: true,
  left: true,
  right: true,
  enter: true,
  esc: true,
  tab: true,
  'shift+tab': true,
  'ctrl+c': true,
  '1': true,
  '2': true,
  '3': true,
  y: true,
  n: true,
};

/** herdr agent names: lowercase, starting with a letter, at most 32 characters. */
const HERDR_AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
/** Executables omp runs as: `omp` or `omp.exe`. */
const OMP_PROCESS_PATTERN = /^omp(\.exe)?$/i;

const REQUEST_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 15_000;
const PROMPT_TIMEOUT_MS = 10_000;
/** How long herdr may take to bring a new interactive agent (Claude, agy) to its prompt. */
const AGENT_START_TIMEOUT_MS = 60_000;
/** How long a prompt waits for an agent herdr just started or woke to accept it. */
const PROMPT_READY_WAIT_MS = 90_000;
const PROMPT_READY_RETRY_MS = 2_000;
const GIT_TIMEOUT_MS = 5_000;
/** Upper bound for reading one omp transcript, so a slow disk cannot stall the board. */
const OMP_TRANSCRIPT_TIMEOUT_MS = 5_000;
/** A checkout lookup, even a negative one, is reused this long before git runs again. */
const GIT_CACHE_TTL_MS = 30_000;
/** Coalesces bursts of pane events into one `agent.list`. */
const REFRESH_DELAY_MS = 150;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Re-reads the roster this often, since a sleep writes the registry without any herdr event. */
const SLEEP_POLL_MS = 10_000;
/** A pane whose wake was sent refuses another wake this long, while herdr brings omp back up. */
const WAKE_PENDING_MS = 20_000;
/** Longest prompt a wake types into a sleeping pane. */
const WAKE_PROMPT_MAX_CHARS = 4_000;
/** A screen watch stays open this long after its most recent renewal. */
const SCREEN_WATCH_MS = 30_000;
/** Event-driven reads of one watched pane are spaced at least this far apart. */
const SCREEN_THROTTLE_MS = 120;
const MAX_SCREEN_WATCHES = 4;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const LINE_FEED = 0x0a;
const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\';
const SUBSCRIBE_REQUEST_ID = 'subscribe';
const HERDR_STATUSES = ['working', 'blocked', 'idle', 'done'] as const;

const NOT_CONNECTED_MESSAGE = 'Chưa kết nối tới herdr.';
const UNREACHABLE_MESSAGE = 'Không kết nối được tới herdr. Kiểm tra herdr đã chạy.';
const CLOSED_MESSAGE = 'Kết nối tới herdr đã đóng.';
const TIMEOUT_MESSAGE = 'herdr không phản hồi kịp thời.';
const INVALID_REPLY_MESSAGE = 'herdr trả về dữ liệu không hợp lệ.';
const REPLY_TOO_LARGE_MESSAGE = 'Phản hồi từ herdr quá lớn.';
const REJECTED_MESSAGE = 'herdr từ chối yêu cầu.';
const UNKNOWN_MESSAGE = 'Lỗi không xác định khi làm việc với herdr.';
const AGENT_NOT_FOUND_MESSAGE = 'Không tìm thấy agent ở pane này. Có thể pane đã đóng.';
const AGENT_BLOCKED_MESSAGE =
  'Agent đang chờ xác nhận (blocked). Hãy xem màn hình rồi trả lời bằng phím.';
const INVALID_PANE_MESSAGE = 'Mã pane không hợp lệ.';
const INVALID_PROMPT_MESSAGE = 'Nội dung prompt không được để trống.';
const PROMPT_TOO_LARGE_MESSAGE = 'Nội dung prompt quá dài (tối đa 32 KiB).';
const INVALID_KEYS_MESSAGE = 'Danh sách phím không hợp lệ.';
const INVALID_LINES_MESSAGE = 'Số dòng cần đọc phải từ 1 đến 2000.';
const INVALID_AGENT_NAME_MESSAGE =
  'Tên agent chỉ gồm chữ thường a-z, số, "_" hoặc "-", bắt đầu bằng chữ cái và tối đa 32 ký tự.';

const INVALID_WAKE_PROMPT_MESSAGE = 'Nội dung đánh thức không được để trống.';
const WAKE_PROMPT_TOO_LONG_MESSAGE = `Nội dung đánh thức quá dài (tối đa ${WAKE_PROMPT_MAX_CHARS} ký tự).`;
const WAKE_PROMPT_ONE_LINE_MESSAGE =
  'Nội dung đánh thức chỉ được một dòng, không chứa ký tự điều khiển.';
const WAKE_PENDING_MESSAGE = 'Đang đánh thức phiên này, hãy chờ omp chạy lại.';
const WAKE_NOT_FOUND_MESSAGE = 'Phiên này không còn ngủ đông. Hãy làm mới bảng.';
/** Why a session that stood asleep can no longer be woken, keyed by the judge's reason. */
const WAKE_REFUSALS: Record<SleepDropReason, string> = {
  'exit-requested': 'Phiên omp vẫn đang thoát, chưa ngủ xong. Thử lại sau vài giây.',
  superseded: 'Thông tin ngủ đông của phiên này đã cũ. Hãy làm mới bảng.',
  'pane-closed': 'Pane của phiên ngủ đông đã đóng, không thể đánh thức.',
  awake: 'Pane này đang chạy agent, phiên không còn ngủ đông.',
  'pane-changed': 'Pane này đã dùng cho việc khác, không còn là phiên ngủ đông.',
  'open-elsewhere': 'Phiên này đang mở ở pane khác, không thể đánh thức ở đây.',
  expired: 'Phiên này ngủ quá 7 ngày nên bảng không mở lại nữa; mở tay bằng lệnh resume nếu cần.',
};

const NOTE_NOT_OMP = 'Agent này không chạy omp, nên chỉ có thư mục làm việc từ herdr.';
const NOTE_NO_SESSION_PATH = 'omp chưa báo đường dẫn transcript, nên chỉ có thông tin từ herdr.';
const NOTE_NO_TRANSCRIPT = 'Không đọc được transcript của omp, nên chỉ có thông tin từ herdr.';
const NOTE_TRANSCRIPT_SLOW = 'Đọc transcript của omp quá lâu, nên chỉ có thông tin từ herdr.';
const NOTE_TRUNCATED =
  `Phiên quá dài: số lần dùng công cụ và kỹ năng chỉ tính ${OMP_TAIL_BYTES / (1024 * 1024)} MB ` +
  'cuối của transcript.';

export type HerdrErrorCode =
  | 'invalid_request'
  | 'herdr_unavailable'
  | 'herdr_timeout'
  | 'herdr_rejected'
  | 'agent_not_found'
  | 'agent_blocked'
  | 'not_sleeping';

/** Carries a Vietnamese message that is safe to show to the board user. */
export class HerdrError extends Error {
  readonly code: HerdrErrorCode;

  constructor(code: HerdrErrorCode, message: string) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
  }
}

/** herdr's agent_not_ready: the agent is still starting. Shown as herdr_rejected when it never gets ready. */
class AgentNotReadyError extends HerdrError {
  constructor() {
    super('herdr_rejected', 'Agent trong pane chưa sẵn sàng nhận việc (agent_not_ready).');
  }
}

/** Schedules a callback and returns the function that cancels it. Injected so tests drive time explicitly. */
export interface HerdrScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export const herdrTimerScheduler: HerdrScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    // Herdr timers must never keep the server process alive on their own.
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/** Deferred; `Promise.withResolvers` needs a newer lib than this project targets. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Runs `git -C <cwd> <args>` and resolves with stdout; rejects when git fails or is missing. */
export type HerdrGitRunner = (cwd: string, args: readonly string[]) => Promise<string>;

export interface HerdrLinkOptions {
  /** herdr socket path. Defaults to the path resolved from the environment. */
  readonly socketPath?: string;
  readonly scheduler?: HerdrScheduler;
  /** Runs git for checkout lookups. Defaults to the `git` on PATH; tests inject a stub. */
  readonly runGit?: HerdrGitRunner;
  /** The sleep registry the omp sleep script keeps. Defaults to `~/.omp/agent/omp-ngu.json`. */
  readonly sleepRegistryFile?: string;
  /**
   * The wake prompt script a session whose pane the sleep closed reopens with, in a new tab.
   * Defaults to `~/.omp/scripts/cho-omp.ps1`.
   */
  readonly wakeStubFile?: string;
  /** Receives problems with the sleep registry, once per distinct problem. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
  /**
   * Canonical path of the open Company folder that holds a cwd (deepest match), or undefined when
   * the cwd lies outside every open folder. Never rejects. Defaults to no folder.
   */
  readonly workspaceFor?: (cwd: string) => Promise<string | undefined>;
}

export interface HerdrLink {
  /** Starts connecting in the background and keeps reconnecting until stopped. */
  start(): void;
  /** Cancels reconnects, subscriptions, and screen watches. */
  stop(): void;
  snapshot(): HerdrAgentsMessage;
  onAgents(listener: (message: HerdrAgentsMessage) => void): () => void;
  onScreen(listener: (message: HerdrScreenMessage) => void): () => void;
  /** Re-tags the roster against the open folders as they now stand, after the folder list changed. */
  rescope(): Promise<void>;
  read(paneId: string, lines: number): Promise<HerdrScreenMessage>;
  /**
   * Opens or renews the live screen watch on a pane; `watching` false closes it. An open watch
   * emits `herdrScreen` as the pane's text changes and lapses 30 s after its last renewal.
   */
  watch(paneId: string, watching: boolean): void;
  prompt(paneId: string, text: string): Promise<void>;
  keys(paneId: string, keys: readonly HerdrKey[]): Promise<void>;
  focus(paneId: string): Promise<void>;
  /** Renames the agent in a pane; the name must match herdr's agent-name pattern. */
  rename(paneId: string, name: string): Promise<void>;
  /** Where the agent in a pane runs, and what omp reports about it. Read-only. */
  info(paneId: string): Promise<BoardAgentInfo>;
  /**
   * Wakes a sleeping session by resuming it in its pane (or in a new tab when the sleep closed its
   * pane), typing `prompt` first when one is given. Refuses unless herdr and the sleep registry
   * still show the pane holding that session. Resolves with the pane the session now runs in.
   */
  wake(paneId: string, prompt?: string): Promise<string>;
  close(paneId: string): Promise<void>;
  /**
   * Opens a new herdr tab in `cwd` and starts an interactive agent of `kind` in it, named `name`,
   * with `args` on its command line; types `prompt` once the agent is ready, when one is given.
   * Resolves with the new pane's id once the roster lists it.
   */
  startAgent(input: HerdrAgentStart): Promise<string>;
  /** Starts a wrapped interactive CLI in a shell tab; the command is a path, never shell text. */
  startCli(input: HerdrCliStart): Promise<string>;
}

/** What a wrapped CLI tab runs. */
export interface HerdrCliStart {
  readonly cwd: string;
  readonly name: string;
  readonly command: string;
  readonly prompt?: string;
}

/** What a new interactive agent tab runs. */
export interface HerdrAgentStart {
  readonly cwd: string;
  readonly kind: BoardAgentEngine | HerdrAgentEngine;
  readonly name: string;
  readonly args?: readonly string[];
  readonly prompt?: string;
}

export { isHerdrPaneId };

export function isHerdrKey(value: unknown): value is HerdrKey {
  return typeof value === 'string' && Object.hasOwn(HERDR_KEY_SET, value);
}

/**
 * Resolves the herdr socket the same way herdr's own CLI does:
 * HERDR_SOCKET_PATH, then HERDR_SESSION under the config directory, then the default socket.
 */
export function resolveHerdrSocketPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string {
  const explicit = env.HERDR_SOCKET_PATH;
  if (explicit) return explicit;
  const pathLib = platform === 'win32' ? path.win32 : path.posix;
  const configDir =
    platform === 'win32'
      ? pathLib.join(env.APPDATA ?? pathLib.join(homeDir, 'AppData', 'Roaming'), 'herdr')
      : pathLib.join(homeDir, '.config', 'herdr');
  const session = env.HERDR_SESSION;
  if (session) return pathLib.join(configDir, 'sessions', session, 'herdr.sock');
  return pathLib.join(configDir, 'herdr.sock');
}

/** Windows herdr listens on a named pipe whose name is the socket path. */
export function herdrEndpoint(
  socketPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32' || socketPath.startsWith(WINDOWS_PIPE_PREFIX)) return socketPath;
  return WINDOWS_PIPE_PREFIX + socketPath;
}

export function createHerdrLink(options: HerdrLinkOptions = {}): HerdrLink {
  return new HerdrLinkImpl(options);
}

/** A herdr subscription entry; only the fields this link uses are typed. */
interface HerdrSubscription {
  readonly type: string;
  readonly pane_id?: string;
}

/** One herdr wire line: a reply to a request (`id`) or a pushed subscription event (`event`). */
interface HerdrEnvelope {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown };
  readonly event?: unknown;
  readonly data?: unknown;
}

interface PingResult {
  readonly protocol?: unknown;
}

interface AgentListResult {
  readonly agents?: unknown;
}

/** The `workspace.list` reply this board reads. */
interface WorkspaceListResult {
  readonly workspaces?: unknown;
}

/** The `workspace.list` entry fields this board reads. */
interface WorkspaceInfo {
  readonly workspace_id?: unknown;
  readonly label?: unknown;
}

/** The `agent.list` entry fields this board reads. */
interface AgentInfo {
  readonly pane_id?: unknown;
  readonly workspace_id?: unknown;
  readonly agent?: unknown;
  readonly agent_status?: unknown;
  readonly name?: unknown;
  readonly terminal_title?: unknown;
  readonly terminal_title_stripped?: unknown;
  readonly cwd?: unknown;
  readonly focused?: unknown;
  /** What the agent reported to herdr: `{kind: 'path' | 'id', value}`. */
  readonly agent_session?: unknown;
}

/** Shared by `agent.read` replies. */
interface PaneReadPayload {
  readonly read?: { readonly text?: unknown };
}

interface HerdrEventStream {
  close(): void;
}

interface HerdrEventHandlers {
  onStarted(): void;
  onEvent(event: string, data: unknown): void;
  onFailure(code: string | undefined, error: HerdrError): void;
}

interface ScreenWatch {
  readonly paneId: string;
  /** Cancels the lease that closes the watch unless it is renewed. */
  cancelExpiry: () => void;
  cancelThrottle?: () => void;
  /** Revision of the latest `pane.updated` event seen for this pane. */
  revision?: number;
  /** An update arrived while the throttle window was open. */
  dirty: boolean;
  /** Reads sent for this watch, numbered in send order. */
  reads: number;
  /** Number of the last read whose text was accepted; older replies are dropped. */
  shown: number;
  /** Digest of the text last emitted; undefined until the first emission. */
  digest?: string;
}

/** The roster as last read from herdr, before workspace labels and checkout facts are added. */
interface RosterSnapshot {
  readonly agents: readonly HerdrAgent[];
  readonly labels: ReadonlyMap<string, string>;
  readonly sleeping: readonly SleepingSession[];
  /** Canonical open folder per cwd, for the cwds that lie inside one. */
  readonly folders: ReadonlyMap<string, string>;
}

/** Git facts for the checkout a cwd sits in. `branch` is absent on a detached HEAD. */
interface GitCheckout {
  repo?: string;
  branch?: string;
  worktreeRoot: string;
}

/** A transcript read yields its summary, or the note that explains why herdr facts stand alone. */
type TranscriptRead = { readonly summary: OmpTranscriptSummary } | { readonly note: string };

/** Facts gathered for `info`; any may be missing, and the result still holds what is known. */
interface AgentInfoFacts {
  readonly rosterCwd?: string;
  readonly foregroundCwd?: string;
  readonly read: TranscriptRead;
  readonly collectedAt: string;
}

const MEMBERSHIP_SUBSCRIPTIONS: readonly HerdrSubscription[] = [
  { type: 'pane.created' },
  { type: 'pane.closed' },
  { type: 'pane.exited' },
  { type: 'pane.agent_detected' },
  { type: 'pane.focused' },
];

class HerdrLinkImpl implements HerdrLink {
  private readonly endpoint: string;
  private readonly scheduler: HerdrScheduler;
  private readonly agentListeners = new Set<(message: HerdrAgentsMessage) => void>();
  private readonly screenListeners = new Set<(message: HerdrScreenMessage) => void>();
  private readonly watches = new Map<string, ScreenWatch>();
  private message: HerdrAgentsMessage = {
    type: 'herdrAgents',
    available: false,
    reason: NOT_CONNECTED_MESSAGE,
    agents: [],
    sleeping: [],
  };
  private running = false;
  /** Bumped whenever pending work must be dropped (stop, failure). */
  private generation = 0;
  private requestCount = 0;
  private reconnectAttempts = 0;
  private cancelReconnect?: () => void;
  private cancelRefresh?: () => void;
  private events?: HerdrEventStream;
  private eventsKey?: string;
  private readonly runGit: HerdrGitRunner;
  private readonly workspaceFor: (cwd: string) => Promise<string | undefined>;
  private roster: RosterSnapshot = {
    agents: [],
    labels: new Map<string, string>(),
    sleeping: [],
    folders: new Map<string, string>(),
  };
  /** Checkout lookups by cwd; `undefined` marks a cwd outside any git checkout. */
  private readonly checkouts = new Map<string, GitCheckout | undefined>();
  private readonly pendingCheckouts = new Set<string>();
  private readonly sleepRegistry: SleepRegistry;
  private readonly wakeStubFile: string;
  /** Cancels the expiry of each pane whose wake is in flight, keyed by pane id. */
  private readonly pendingWakes = new Map<string, () => void>();
  private cancelSleepPoll?: () => void;
  /** The `pane.updated` stream every screen watch shares; open exactly while a watch exists. */
  private screenEvents?: HerdrEventStream;

  constructor(options: HerdrLinkOptions) {
    this.endpoint = herdrEndpoint(options.socketPath ?? resolveHerdrSocketPath(process.env));
    this.scheduler = options.scheduler ?? herdrTimerScheduler;
    this.runGit = options.runGit ?? runGitCommand;
    this.workspaceFor = options.workspaceFor ?? (async () => undefined);
    this.sleepRegistry = new SleepRegistry({
      file: options.sleepRegistryFile ?? path.join(os.homedir(), '.omp', 'agent', 'omp-ngu.json'),
      warn: options.warn ?? ((message: string) => console.warn(message)),
    });
    this.wakeStubFile = options.wakeStubFile ?? path.join(os.homedir(), '.omp', 'scripts', 'cho-omp.ps1');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.cancelReconnect?.();
    this.cancelReconnect = undefined;
    this.cancelRefresh?.();
    this.cancelRefresh = undefined;
    this.cancelSleepPoll?.();
    this.cancelSleepPoll = undefined;
    for (const cancelExpiry of this.pendingWakes.values()) cancelExpiry();
    this.pendingWakes.clear();
    this.closeEvents();
    this.closeAllWatches();
  }

  snapshot(): HerdrAgentsMessage {
    return this.message;
  }

  onAgents(listener: (message: HerdrAgentsMessage) => void): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  onScreen(listener: (message: HerdrScreenMessage) => void): () => void {
    this.screenListeners.add(listener);
    return () => this.screenListeners.delete(listener);
  }

  /** Re-tags the roster against the open folders as they now stand, after the folder list changed. */
  async rescope(): Promise<void> {
    if (!this.running || !this.message.available) return;
    const generation = this.generation;
    const roster = await this.withFolders(this.roster);
    if (!this.isCurrent(generation)) return;
    this.roster = roster;
    this.publishRoster();
  }

  async read(paneId: string, lines: number): Promise<HerdrScreenMessage> {
    assertPaneId(paneId);
    assertLines(lines);
    const text = await this.readPaneText(paneId, lines);
    if (text === undefined) throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
    return { type: 'herdrScreen', paneId, text, at: new Date().toISOString() };
  }

  watch(paneId: string, watching: boolean): void {
    assertPaneId(paneId);
    if (!watching) {
      this.closeWatch(paneId);
      return;
    }
    const existing = this.watches.get(paneId);
    if (existing !== undefined) {
      this.renewLease(existing);
      return;
    }
    if (this.watches.size >= MAX_SCREEN_WATCHES) {
      for (const oldest of this.watches.keys()) {
        this.closeWatch(oldest);
        break;
      }
    }
    const watch: ScreenWatch = {
      paneId,
      cancelExpiry: () => undefined,
      dirty: false,
      reads: 0,
      shown: 0,
    };
    this.watches.set(paneId, watch);
    this.renewLease(watch);
    this.openScreenEvents();
    // A new watch has no digest yet, so its first reading is always emitted.
    void this.readScreen(watch);
  }

  /**
   * Sends a prompt. An agent herdr just started or woke is not ready for a few seconds and herdr
   * answers agent_not_ready: the prompt is sent again until it is taken or PROMPT_READY_WAIT_MS ends.
   */
  async prompt(paneId: string, text: string): Promise<void> {
    assertPaneId(paneId);
    assertPrompt(text);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.call('agent.prompt', { target: paneId, text }, PROMPT_TIMEOUT_MS);
        return;
      } catch (error) {
        if (!(error instanceof AgentNotReadyError) || attempt * PROMPT_READY_RETRY_MS >= PROMPT_READY_WAIT_MS) throw error;
      }
      await new Promise<void>((resolve) => this.scheduler.schedule(resolve, PROMPT_READY_RETRY_MS));
    }
  }

  async keys(paneId: string, keys: readonly HerdrKey[]): Promise<void> {
    assertPaneId(paneId);
    if (keys.length === 0 || keys.length > HERDR_MAX_KEYS || !keys.every(isHerdrKey)) {
      throw new HerdrError('invalid_request', INVALID_KEYS_MESSAGE);
    }
    await this.call('agent.send_keys', { target: paneId, keys: [...keys] });
  }

  async focus(paneId: string): Promise<void> {
    assertPaneId(paneId);
    await this.call('agent.focus', { target: paneId });
  }

  async rename(paneId: string, name: string): Promise<void> {
    assertPaneId(paneId);
    assertAgentName(name);
    await this.call('agent.rename', { target: paneId, name });
    // Reconcile now: the new name may not reach the roster through a pane event.
    if (this.running) this.scheduleRefresh();
  }

  async info(paneId: string): Promise<BoardAgentInfo> {
    assertPaneId(paneId);
    const listed = findListedAgent(await this.call('agent.list', {}), paneId);
    const [foregroundCwd, read] = await Promise.all([
      this.foregroundCwd(paneId),
      this.readTranscript(listed),
    ]);
    return composeAgentInfo({
      rosterCwd: nonEmptyString(jsonField(listed, 'cwd')),
      foregroundCwd,
      read,
      collectedAt: new Date().toISOString(),
    });
  }

  async close(paneId: string): Promise<void> {
    assertPaneId(paneId);
    // A deep sleep already closed its pane: `zz:` names the registry record, not a herdr pane, so
    // pane.close could only fail. Removing it means dropping that record.
    if (paneId.startsWith('zz:')) {
      const closed = await this.assertSleeping(paneId);
      if (closed !== undefined) await this.sleepRegistry.forgetClosed(closed.file);
    } else {
      await this.call('pane.close', { pane_id: paneId });
    }
    if (this.running) this.scheduleRefresh();
  }

  async startAgent(input: HerdrAgentStart): Promise<string> {
    assertAgentName(input.name);
    if (input.prompt !== undefined) assertPrompt(input.prompt);
    const created = await this.call('tab.create', { cwd: input.cwd, label: input.name, focus: false });
    const paneId = nonEmptyString(jsonField(jsonField(created, 'root_pane'), 'pane_id'));
    if (paneId === undefined) throw new HerdrError('invalid_request', 'herdr không trả về pane của tab mới.');
    try {
      await this.call(
        'agent.start',
        {
          name: input.name,
          kind: input.kind,
          pane_id: paneId,
          args: [...(input.args ?? [])],
          timeout_ms: AGENT_START_TIMEOUT_MS,
        },
        AGENT_START_TIMEOUT_MS + REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      // An agent that never came up leaves no empty shell tab behind.
      await this.call('pane.close', { pane_id: paneId }).catch(() => undefined);
      throw error;
    }
    // The roster lists the pane before this resolves, so a caller that assigns work to it sees it.
    if (this.running) await this.refresh(this.generation);
    if (input.prompt !== undefined) await this.prompt(paneId, input.prompt);
    return paneId;
  }

  async startCli(input: HerdrCliStart): Promise<string> {
    assertAgentName(input.name);
    if (/[\r\n\0]/.test(input.command)) throw new HerdrError('invalid_request', 'Đường dẫn CLI không hợp lệ.');
    if (input.prompt !== undefined) assertPrompt(input.prompt);
    const created = await this.call('tab.create', { cwd: input.cwd, label: input.name, focus: false });
    const paneId = nonEmptyString(jsonField(jsonField(created, 'root_pane'), 'pane_id'));
    if (paneId === undefined) throw new HerdrError('invalid_request', 'herdr không trả về pane của tab mới.');
    try {
      const command = `& '${input.command.replaceAll("'", "''")}'`;
      await this.call('pane.send_text', { pane_id: paneId, text: command });
      await this.call('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
      const prompt = input.prompt?.trim();
      if (prompt !== undefined && prompt !== '') {
        await this.call('pane.send_text', { pane_id: paneId, text: prompt });
        await this.call('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
      }
    } catch (error) {
      await this.call('pane.close', { pane_id: paneId }).catch(() => undefined);
      throw error;
    }
    if (this.running) this.scheduleRefresh();
    return paneId;
  }

  async wake(paneId: string, prompt?: string): Promise<string> {
    assertPaneId(paneId);
    if (prompt !== undefined) assertWakePrompt(prompt);
    if (this.pendingWakes.has(paneId)) throw new HerdrError('not_sleeping', WAKE_PENDING_MESSAGE);
    this.pendingWakes.set(
      paneId,
      this.scheduler.schedule(() => {
        this.pendingWakes.delete(paneId);
      }, WAKE_PENDING_MS),
    );
    let awakeIn = paneId;
    try {
      const closed = await this.assertSleeping(paneId);
      if (closed !== undefined) {
        awakeIn = await this.wakeInNewTab(closed, prompt);
      } else {
        if (prompt !== undefined)
          await this.call('pane.send_text', { pane_id: paneId, text: prompt });
        await this.call('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
      }
    } catch (error) {
      this.pendingWakes.get(paneId)?.();
      this.pendingWakes.delete(paneId);
      throw error;
    }
    if (this.running) this.scheduleRefresh();
    return awakeIn;
  }

  /**
   * Refuses unless herdr's panes and the sleep registry still show this pane holding a sleeping
   * session. Returns how to reopen it when the sleep closed its pane; undefined when the pane is open.
   */
  private async assertSleeping(paneId: string): Promise<ClosedSleepWake | undefined> {
    const panes = parsePaneList(await this.call('pane.list', {}));
    const judgements = await this.sleepRegistry.judge(panes);
    // The registry lists records in write order, so the last one for a pane is its live state.
    const latest = judgements.filter((judgement) => judgement.paneId === paneId).at(-1);
    if (latest === undefined) throw new HerdrError('not_sleeping', WAKE_NOT_FOUND_MESSAGE);
    if (latest.status === 'dropped') {
      throw new HerdrError('not_sleeping', WAKE_REFUSALS[latest.reason]);
    }
    return latest.closed;
  }

  /**
   * Reopens a session whose pane the sleep closed: a new tab in its folder runs the wake prompt
   * script with -Ngay, which refuses a session already open elsewhere and resumes at once.
   */
  private async wakeInNewTab(plan: ClosedSleepWake, prompt?: string): Promise<string> {
    const tab = { cwd: plan.cwd, focus: false };
    let created: unknown;
    try {
      created = await this.call(
        'tab.create',
        plan.workspaceId === undefined ? tab : { ...tab, workspace_id: plan.workspaceId },
      );
    } catch (error) {
      // The workspace may be gone (herdr restarted): any workspace will do for the session.
      if (plan.workspaceId === undefined || !(error instanceof HerdrError)) throw error;
      created = await this.call('tab.create', tab);
    }
    const newPane = nonEmptyString(jsonField(jsonField(created, 'root_pane'), 'pane_id'));
    if (newPane === undefined) throw new HerdrError('invalid_request', 'herdr không trả về pane của tab mới.');
    await this.call('pane.send_text', {
      pane_id: newPane,
      text: closedWakeCommand(this.wakeStubFile, plan, prompt),
    });
    await this.call('pane.send_keys', { pane_id: newPane, keys: ['enter'] });
    // The wake is under way in its own tab: the record has done its job (see forgetClosed).
    await this.sleepRegistry.forgetClosed(plan.file);
    return newPane;
  }

  /** Working directory of the pane's foreground process; `undefined` when herdr cannot say. */
  private async foregroundCwd(paneId: string): Promise<string | undefined> {
    try {
      return foregroundProcessCwd(await this.call('pane.process_info', { pane_id: paneId }));
    } catch (error) {
      // The roster cwd stands in when herdr cannot describe the pane's processes.
      if (error instanceof HerdrError) return undefined;
      throw error;
    }
  }

  /** Reads the agent's omp transcript under a deadline; every failure becomes a note instead. */
  private async readTranscript(listed: unknown): Promise<TranscriptRead> {
    if (jsonField(listed, 'agent') !== 'omp') return { note: NOTE_NOT_OMP };
    const session = jsonField(listed, 'agent_session');
    const file =
      jsonField(session, 'kind') === 'path'
        ? nonEmptyString(jsonField(session, 'value'))
        : undefined;
    if (file === undefined) return { note: NOTE_NO_SESSION_PATH };
    const reading: Promise<TranscriptRead> = readOmpTranscript(file).then(
      (summary) => ({ summary }),
      () => ({ note: NOTE_NO_TRANSCRIPT }),
    );
    let cancelDeadline: () => void = () => undefined;
    const deadline = new Promise<TranscriptRead>((resolve) => {
      cancelDeadline = this.scheduler.schedule(
        () => resolve({ note: NOTE_TRANSCRIPT_SLOW }),
        OMP_TRANSCRIPT_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([reading, deadline]);
    } finally {
      cancelDeadline();
    }
  }

  private async connect(): Promise<void> {
    const generation = this.generation;
    try {
      assertCompatible(await this.call('ping', {}));
      if (!this.isCurrent(generation)) return;
      const roster = await this.readRoster();
      if (!this.isCurrent(generation)) return;
      this.reconnectAttempts = 0;
      this.setRoster(roster);
      this.syncEvents(generation, roster.agents);
    } catch (error) {
      this.fail(generation, error);
    }
  }

  private async refresh(generation: number): Promise<void> {
    try {
      const roster = await this.readRoster();
      if (!this.isCurrent(generation)) return;
      this.setRoster(roster);
      this.syncEvents(generation, roster.agents);
    } catch (error) {
      this.fail(generation, error);
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private fail(generation: number, error: unknown): void {
    if (!this.isCurrent(generation)) return;
    this.generation += 1;
    this.cancelRefresh?.();
    this.cancelRefresh = undefined;
    this.cancelSleepPoll?.();
    this.cancelSleepPoll = undefined;
    this.closeEvents();
    this.publish({
      type: 'herdrAgents',
      available: false,
      reason: error instanceof HerdrError ? error.message : UNKNOWN_MESSAGE,
      agents: [],
      sleeping: [],
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.cancelReconnect = this.scheduler.schedule(() => {
      this.cancelReconnect = undefined;
      void this.connect();
    }, delay);
  }

  private scheduleRefresh(): void {
    if (this.cancelRefresh !== undefined) return;
    const generation = this.generation;
    this.cancelRefresh = this.scheduler.schedule(() => {
      this.cancelRefresh = undefined;
      void this.refresh(generation);
    }, REFRESH_DELAY_MS);
  }

  /** Keeps the status subscription aligned with the current pane set; any event triggers a reconcile. */
  private syncEvents(generation: number, agents: readonly HerdrAgent[]): void {
    const paneIds = agents.map((agent) => agent.paneId);
    const key = JSON.stringify(paneIds);
    if (this.events !== undefined && this.eventsKey === key) return;
    this.closeEvents();
    this.eventsKey = key;
    const subscriptions: HerdrSubscription[] = [
      ...MEMBERSHIP_SUBSCRIPTIONS,
      ...paneIds.map((paneId) => ({ type: 'pane.agent_status_changed', pane_id: paneId })),
    ];
    const stream = openEventStream(this.endpoint, subscriptions, {
      onStarted: () => {
        if (this.events === stream && this.isCurrent(generation)) this.scheduleRefresh();
      },
      onEvent: () => {
        if (this.events === stream && this.isCurrent(generation)) this.scheduleRefresh();
      },
      onFailure: (code, error) => {
        if (this.events !== stream || !this.isCurrent(generation)) return;
        if (code === 'events_lost') {
          // Cached state may be stale: drop the stream and reconcile from agent.list.
          this.closeEvents();
          this.scheduleRefresh();
          return;
        }
        this.fail(generation, error);
      },
    });
    this.events = stream;
  }

  private closeEvents(): void {
    this.events?.close();
    this.events = undefined;
    this.eventsKey = undefined;
  }

  private setRoster(roster: RosterSnapshot): void {
    this.roster = roster;
    this.publishRoster();
    for (const agent of roster.agents) {
      if (agent.cwd !== undefined) this.lookupCheckout(agent.cwd);
    }
    for (const session of roster.sleeping) {
      if (session.cwd !== undefined) this.lookupCheckout(session.cwd);
    }
    this.scheduleSleepPoll();
  }

  /** Publishes the last roster with the workspace labels and checkout facts known so far. */
  private publishRoster(): void {
    const { agents, labels, sleeping, folders } = this.roster;
    this.publish({
      type: 'herdrAgents',
      available: true,
      agents: agents.map((agent) =>
        withFolder(withRosterFields(agent, labels, this.checkouts), agent.cwd, folders),
      ),
      sleeping: sleeping.map((session) =>
        withFolder(withSleepingFields(session, labels, this.checkouts), session.cwd, folders),
      ),
    });
  }

  /** Adds the open folder holding each agent's and sleeping pane's cwd; an entry outside every folder gets none. */
  private async withFolders(roster: Omit<RosterSnapshot, 'folders'>): Promise<RosterSnapshot> {
    const cwds = new Set<string>();
    for (const agent of roster.agents) {
      if (agent.cwd !== undefined) cwds.add(agent.cwd);
    }
    for (const session of roster.sleeping) {
      if (session.cwd !== undefined) cwds.add(session.cwd);
    }
    const folders = new Map<string, string>();
    await Promise.all(
      [...cwds].map(async (cwd) => {
        const folder = await this.workspaceFor(cwd);
        if (folder !== undefined) folders.set(cwd, folder);
      }),
    );
    return { ...roster, folders };
  }

  /**
   * Reads agents, workspace labels, and sleeping sessions together. A failed label read only
   * drops the labels; a failed pane read only drops the sleeping sessions.
   */
  private async readRoster(): Promise<RosterSnapshot> {
    const [agentsReply, labels, sleeping] = await Promise.all([
      this.call('agent.list', {}),
      this.readWorkspaceLabels(),
      this.readSleeping(),
    ]);
    return this.withFolders({ agents: parseAgentList(agentsReply), labels, sleeping });
  }

  private async readWorkspaceLabels(): Promise<ReadonlyMap<string, string>> {
    try {
      return parseWorkspaceLabels(await this.call('workspace.list', {}));
    } catch {
      // Labels are decoration: a failed workspace.list must not drop the roster.
      return new Map<string, string>();
    }
  }

  /**
   * Sleeping sessions as herdr's panes show them now. A failed pane read lists none, so no
   * session is offered that herdr could not confirm.
   */
  private async readSleeping(): Promise<readonly SleepingSession[]> {
    let panes: PaneFact[];
    try {
      panes = parsePaneList(await this.call('pane.list', {}));
    } catch (error) {
      if (error instanceof HerdrError) return [];
      throw error;
    }
    return this.sleepRegistry.sleepingSessions(panes);
  }

  /** Re-reads the roster on a timer too, since a sleep writes the registry without any herdr event. */
  private scheduleSleepPoll(): void {
    this.cancelSleepPoll?.();
    const generation = this.generation;
    this.cancelSleepPoll = this.scheduler.schedule(() => {
      this.cancelSleepPoll = undefined;
      void this.refresh(generation);
    }, SLEEP_POLL_MS);
  }

  /** Starts a git lookup for `cwd` unless one is cached or running; the roster never waits. */
  private lookupCheckout(cwd: string): void {
    if (this.checkouts.has(cwd) || this.pendingCheckouts.has(cwd)) return;
    this.pendingCheckouts.add(cwd);
    void readGitCheckout(cwd, this.runGit).then((checkout) => {
      this.pendingCheckouts.delete(cwd);
      this.checkouts.set(cwd, checkout);
      this.scheduler.schedule(() => {
        this.checkouts.delete(cwd);
      }, GIT_CACHE_TTL_MS);
      if (this.running && this.message.available) this.publishRoster();
    });
  }

  private publish(next: HerdrAgentsMessage): void {
    if (JSON.stringify(next) === JSON.stringify(this.message)) return;
    this.message = next;
    for (const listener of [...this.agentListeners]) listener(next);
  }

  /** Restarts the watch's lease: it closes after a full lease passes without another renewal. */
  private renewLease(watch: ScreenWatch): void {
    watch.cancelExpiry();
    watch.cancelExpiry = this.scheduler.schedule(
      () => this.closeWatch(watch.paneId),
      SCREEN_WATCH_MS,
    );
  }

  /** Opens the one `pane.updated` stream every screen watch shares, unless it is already open. */
  private openScreenEvents(): void {
    if (this.screenEvents !== undefined) return;
    const stream = openEventStream(this.endpoint, [{ type: 'pane.updated' }], {
      onStarted: () => {
        // Revisions that moved before the subscription took effect would otherwise be missed.
        if (this.screenEvents !== stream) return;
        for (const watch of [...this.watches.values()]) void this.readScreen(watch);
      },
      onEvent: (event, data) => {
        if (this.screenEvents !== stream) return;
        // herdr sends the event as `pane_updated`; the dotted subscription name is accepted too.
        if (event === 'pane_updated' || event === 'pane.updated') this.onPaneUpdated(data);
      },
      onFailure: () => {
        // One stream serves every watch, so its failure ends them all.
        if (this.screenEvents === stream) this.closeAllWatches();
      },
    });
    this.screenEvents = stream;
  }

  /**
   * Signals the watch of a pane whose revision moved. Other panes and a repeated revision read
   * nothing.
   */
  private onPaneUpdated(data: unknown): void {
    const pane = jsonField(data, 'pane');
    const paneId = nonEmptyString(jsonField(pane, 'pane_id'));
    const revision = jsonField(pane, 'revision');
    if (paneId === undefined || typeof revision !== 'number') return;
    const watch = this.watches.get(paneId);
    if (watch === undefined || watch.revision === revision) return;
    watch.revision = revision;
    this.signalScreen(watch);
  }

  /** The pane's text as herdr renders it, or `undefined` when the reply carries none. */
  private async readPaneText(paneId: string, lines: number): Promise<string | undefined> {
    // herdr ignores strip_ansi; format 'ansi' is the one that keeps SGR colour.
    const result = await this.call(
      'agent.read',
      { target: paneId, source: 'recent_unwrapped', lines, format: 'ansi' },
      READ_TIMEOUT_MS,
    );
    return readText(result);
  }

  /**
   * Reads the pane now and emits its text only if the watch is still open, the reply is newer
   * than the last one accepted, and the text differs from the last one emitted.
   */
  private async readScreen(watch: ScreenWatch): Promise<void> {
    const sequence = ++watch.reads;
    try {
      const text = await this.readPaneText(watch.paneId, HERDR_DEFAULT_READ_LINES);
      if (text === undefined || this.watches.get(watch.paneId) !== watch) return;
      // A late reply must not move the screen back in time, so only the newest reply counts.
      if (sequence <= watch.shown) return;
      watch.shown = sequence;
      const digest = screenDigest(text);
      if (digest === watch.digest) return;
      watch.digest = digest;
      this.emitScreen(watch.paneId, text);
    } catch {
      if (this.watches.get(watch.paneId) === watch) this.closeWatch(watch.paneId);
    }
  }

  /**
   * Leading-plus-trailing throttle over pane updates: the first update reads at once, and updates
   * that arrive inside the window coalesce into one read when the window ends.
   */
  private signalScreen(watch: ScreenWatch): void {
    if (watch.cancelThrottle !== undefined) {
      watch.dirty = true;
      return;
    }
    void this.readScreen(watch);
    this.armThrottle(watch);
  }

  private armThrottle(watch: ScreenWatch): void {
    watch.cancelThrottle = this.scheduler.schedule(() => {
      watch.cancelThrottle = undefined;
      if (!watch.dirty) return;
      watch.dirty = false;
      void this.readScreen(watch);
      this.armThrottle(watch);
    }, SCREEN_THROTTLE_MS);
  }

  private emitScreen(paneId: string, text: string): void {
    const message: HerdrScreenMessage = {
      type: 'herdrScreen',
      paneId,
      text,
      at: new Date().toISOString(),
    };
    for (const listener of [...this.screenListeners]) listener(message);
  }

  private closeWatch(paneId: string): void {
    const watch = this.watches.get(paneId);
    if (watch === undefined) return;
    this.watches.delete(paneId);
    watch.cancelExpiry();
    watch.cancelThrottle?.();
    if (this.watches.size === 0) this.closeScreenEvents();
  }

  private closeAllWatches(): void {
    for (const paneId of [...this.watches.keys()]) this.closeWatch(paneId);
  }

  private closeScreenEvents(): void {
    this.screenEvents?.close();
    this.screenEvents = undefined;
  }

  /** One short-lived connection per request, matching herdr's own client. */
  private call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const { promise, resolve, reject } = deferred<unknown>();
    const id = `omp-${++this.requestCount}`;
    const socket = net.createConnection(this.endpoint);
    const reader = new HerdrLineReader();
    let settled = false;
    let cancelTimeout: () => void = () => undefined;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      socket.destroy();
      outcome();
    };
    cancelTimeout = this.scheduler.schedule(
      () => settle(() => reject(new HerdrError('herdr_timeout', TIMEOUT_MESSAGE))),
      timeoutMs,
    );
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on('error', () =>
      settle(() => reject(new HerdrError('herdr_unavailable', UNREACHABLE_MESSAGE))),
    );
    socket.on('close', () =>
      settle(() => reject(new HerdrError('herdr_unavailable', CLOSED_MESSAGE))),
    );
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of reader.push(chunk)) {
          if (settled) return;
          const reply = parseLine(line);
          if (reply.id !== id) continue;
          if (reply.error !== undefined) {
            const code = typeof reply.error.code === 'string' ? reply.error.code : '';
            settle(() => reject(herdrRequestError(code)));
            return;
          }
          settle(() => resolve(reply.result));
          return;
        }
      } catch (error) {
        settle(() =>
          reject(
            error instanceof HerdrError ? error : new HerdrError('herdr_rejected', UNKNOWN_MESSAGE),
          ),
        );
      }
    });
    return promise;
  }
}

/** Opens a long-lived `events.subscribe` connection. Each pushed line is `{event, data}`. */
function openEventStream(
  endpoint: string,
  subscriptions: readonly HerdrSubscription[],
  handlers: HerdrEventHandlers,
): HerdrEventStream {
  const socket = net.createConnection(endpoint);
  const reader = new HerdrLineReader();
  let open = true;
  const fail = (code: string | undefined, error: HerdrError): void => {
    if (!open) return;
    open = false;
    socket.destroy();
    handlers.onFailure(code, error);
  };
  socket.on('connect', () =>
    socket.write(
      `${JSON.stringify({ id: SUBSCRIBE_REQUEST_ID, method: 'events.subscribe', params: { subscriptions } })}\n`,
    ),
  );
  socket.on('error', () =>
    fail(undefined, new HerdrError('herdr_unavailable', UNREACHABLE_MESSAGE)),
  );
  socket.on('close', () => fail(undefined, new HerdrError('herdr_unavailable', CLOSED_MESSAGE)));
  socket.on('data', (chunk: Buffer) => {
    try {
      for (const line of reader.push(chunk)) {
        if (!open) return;
        const message = parseLine(line);
        if (message.error !== undefined) {
          const code = typeof message.error.code === 'string' ? message.error.code : '';
          fail(code, herdrRequestError(code));
          return;
        }
        if (typeof message.event === 'string') {
          handlers.onEvent(message.event, message.data);
          continue;
        }
        const result = message.result as { readonly type?: unknown } | undefined;
        if (result?.type === 'subscription_started') handlers.onStarted();
      }
    } catch (error) {
      fail(
        undefined,
        error instanceof HerdrError ? error : new HerdrError('herdr_rejected', UNKNOWN_MESSAGE),
      );
    }
  });
  return {
    close() {
      if (!open) return;
      open = false;
      socket.destroy();
    },
  };
}

class HerdrLineReader {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const lines: string[] = [];
    for (
      let newline = this.pending.indexOf(LINE_FEED);
      newline !== -1;
      newline = this.pending.indexOf(LINE_FEED)
    ) {
      const line = this.pending.toString('utf8', 0, newline);
      this.pending = this.pending.subarray(newline + 1);
      if (line.length > 0) lines.push(line);
    }
    if (this.pending.length > MAX_LINE_BYTES)
      throw new HerdrError('herdr_rejected', REPLY_TOO_LARGE_MESSAGE);
    return lines;
  }
}

function parseLine(line: string): HerdrEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
  }
  // Boundary cast: herdr's protocol guarantees this envelope; each field is re-checked where it is read.
  return parsed as HerdrEnvelope;
}

function herdrRequestError(code: string): HerdrError {
  switch (code) {
    case 'agent_not_ready':
      return new AgentNotReadyError();
    case 'agent_blocked':
      return new HerdrError('agent_blocked', AGENT_BLOCKED_MESSAGE);
    case 'agent_not_found':
    case 'pane_not_found':
      return new HerdrError('agent_not_found', AGENT_NOT_FOUND_MESSAGE);
    default:
      return new HerdrError(
        'herdr_rejected',
        code ? `herdr từ chối yêu cầu (${code}).` : REJECTED_MESSAGE,
      );
  }
}

function assertCompatible(pong: unknown): void {
  const reported = (pong as PingResult | undefined)?.protocol;
  if (reported === HERDR_PROTOCOL_VERSION) return;
  const shown = typeof reported === 'number' ? String(reported) : 'không rõ';
  throw new HerdrError(
    'herdr_rejected',
    `Giao thức herdr không khớp (herdr báo ${shown}, board cần ${HERDR_PROTOCOL_VERSION}).`,
  );
}

function parseAgentList(result: unknown): HerdrAgent[] {
  const list: unknown = (result as AgentListResult | undefined)?.agents;
  if (!Array.isArray(list)) throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
  const agents: HerdrAgent[] = [];
  for (const info of list as AgentInfo[]) {
    const agent = toHerdrAgent(info);
    if (agent !== undefined) agents.push(agent);
  }
  return agents.sort((a, b) => (a.paneId < b.paneId ? -1 : a.paneId > b.paneId ? 1 : 0));
}

function toHerdrAgent(info: AgentInfo): HerdrAgent | undefined {
  if (typeof info.pane_id !== 'string' || typeof info.workspace_id !== 'string') return undefined;
  const agent: HerdrAgent = {
    paneId: info.pane_id,
    workspaceId: info.workspace_id,
    kind: typeof info.agent === 'string' ? info.agent : 'unknown',
    status: HERDR_STATUSES.find((status) => status === info.agent_status) ?? 'unknown',
  };
  if (typeof info.name === 'string' && info.name !== '') agent.name = info.name;
  // herdr's stripped title reads best; the raw terminal title is the fallback.
  const title = nonEmptyString(info.terminal_title_stripped) ?? nonEmptyString(info.terminal_title);
  if (title !== undefined) agent.title = title;
  if (typeof info.cwd === 'string' && info.cwd !== '') agent.cwd = info.cwd;
  if (typeof info.focused === 'boolean') agent.focused = info.focused;
  const session = info.agent_session;
  const value = nonEmptyString(jsonField(session, 'value'));
  if (value !== undefined && jsonField(session, 'kind') === 'path') agent.sessionFile = value;
  else if (value !== undefined && jsonField(session, 'kind') === 'id') agent.sessionId = value;
  return agent;
}

/** Tags an entry with the open folder holding its cwd; an entry outside every folder keeps no tag. */
function withFolder<T extends { workspacePath?: string }>(
  entry: T,
  cwd: string | undefined,
  folders: ReadonlyMap<string, string>,
): T {
  const folder = cwd === undefined ? undefined : folders.get(cwd);
  if (folder !== undefined) entry.workspacePath = folder;
  return entry;
}

/** Adds the workspace label and checkout facts known so far; a missing fact leaves its field out. */
function withRosterFields(
  agent: HerdrAgent,
  labels: ReadonlyMap<string, string>,
  checkouts: ReadonlyMap<string, GitCheckout | undefined>,
): HerdrAgent {
  const result: HerdrAgent = { ...agent };
  const label = labels.get(agent.workspaceId);
  if (label !== undefined) result.workspaceLabel = label;
  const checkout = agent.cwd === undefined ? undefined : checkouts.get(agent.cwd);
  applyCheckout(result, checkout);
  return result;
}

/** Copies the checkout facts a lookup found; a lookup that found nothing leaves the target as it is. */
function applyCheckout(
  target: { repo?: string; branch?: string; worktreeRoot?: string },
  checkout: GitCheckout | undefined,
): void {
  if (checkout === undefined) return;
  if (checkout.repo !== undefined) target.repo = checkout.repo;
  if (checkout.branch !== undefined) target.branch = checkout.branch;
  target.worktreeRoot = checkout.worktreeRoot;
}

/** The board's view of a sleeping session: its workspace label and checkout facts when known. */
function withSleepingFields(
  session: SleepingSession,
  labels: ReadonlyMap<string, string>,
  checkouts: ReadonlyMap<string, GitCheckout | undefined>,
): HerdrSleepingSession {
  const result: HerdrSleepingSession = {
    paneId: session.paneId,
    title: session.title,
    sessionFile: session.sessionFile,
    sleptAt: session.sleptAt,
  };
  if (session.cwd !== undefined) result.cwd = session.cwd;
  const label = session.workspaceId === undefined ? undefined : labels.get(session.workspaceId);
  if (label !== undefined) result.workspaceLabel = label;
  const checkout = session.cwd === undefined ? undefined : checkouts.get(session.cwd);
  applyCheckout(result, checkout);
  return result;
}

/** Panes from a `pane.list` reply; an entry without a pane id is skipped. */
function parsePaneList(result: unknown): PaneFact[] {
  const list: unknown = jsonField(result, 'panes');
  if (!Array.isArray(list)) throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
  const panes: PaneFact[] = [];
  for (const info of list as unknown[]) {
    const paneId = jsonField(info, 'pane_id');
    if (typeof paneId !== 'string') continue;
    // omp reports a path, Claude and agy an id: both are what omp-ngu.json records as `file`, so a woken
    // Claude/agy session drops off the sleeping list like an omp one.
    const sessionFile = nonEmptyString(jsonField(jsonField(info, 'agent_session'), 'value'));
    panes.push({
      paneId,
      workspaceId: nonEmptyString(jsonField(info, 'workspace_id')),
      terminalId: nonEmptyString(jsonField(info, 'terminal_id')),
      cwd: nonEmptyString(jsonField(info, 'cwd')),
      label: nonEmptyString(jsonField(info, 'label')),
      agent: nonEmptyString(jsonField(info, 'agent')),
      sessionFile,
    });
  }
  return panes;
}

/** Maps workspace id to label; entries without a usable label are skipped. */
function parseWorkspaceLabels(result: unknown): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const list: unknown = (result as WorkspaceListResult | undefined)?.workspaces;
  if (!Array.isArray(list)) return labels;
  for (const info of list as WorkspaceInfo[]) {
    const label = nonEmptyString(info.label);
    if (typeof info.workspace_id === 'string' && label !== undefined) {
      labels.set(info.workspace_id, label);
    }
  }
  return labels;
}

/** One `git rev-parse` per cwd. Resolves to `undefined` outside a checkout or when git fails. */
async function readGitCheckout(
  cwd: string,
  runGit: HerdrGitRunner,
): Promise<GitCheckout | undefined> {
  let output: string;
  try {
    output = await runGit(cwd, [
      'rev-parse',
      '--show-toplevel',
      '--abbrev-ref',
      'HEAD',
      '--git-common-dir',
    ]);
  } catch {
    return undefined;
  }
  // Output lines follow the argument order: toplevel, HEAD name, common git dir.
  const [toplevel, head, commonDir] = output.split(/\r?\n/);
  if (!toplevel || !head || !commonDir) return undefined;
  // git prints a relative common dir (`.git`) relative to the directory it ran in: `cwd`.
  const worktreeRoot = path.resolve(cwd, toplevel);
  const checkout: GitCheckout = { worktreeRoot };
  const repo = repoName(path.resolve(cwd, commonDir), worktreeRoot);
  if (repo !== undefined) checkout.repo = repo;
  // A detached HEAD prints the literal `HEAD`, so the roster shows no branch for it.
  if (head !== 'HEAD') checkout.branch = head;
  return checkout;
}

/**
 * Names the repository so every worktree of one repo agrees: a normal common dir is
 * `<repo>/.git`, a bare repository is `<name>.git`. Other layouts use the checkout folder name.
 */
function repoName(commonGitDir: string, worktreeRoot: string): string | undefined {
  const base = path.basename(commonGitDir);
  if (base === '.git') return nonEmptyString(path.basename(path.dirname(commonGitDir)));
  if (base.endsWith('.git')) return base.slice(0, -'.git'.length);
  return nonEmptyString(path.basename(worktreeRoot));
}

/** Runs `git` without a shell, so the cwd travels as one argument and is never parsed. */
function runGitCommand(cwd: string, args: readonly string[]): Promise<string> {
  const { promise, resolve, reject } = deferred<string>();
  childProcess.execFile(
    'git',
    ['-C', cwd, ...args],
    { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true },
    (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    },
  );
  return promise;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Reads `read.text` from an `agent.read` reply. */
function readText(value: unknown): string | undefined {
  const text = (value as PaneReadPayload | undefined)?.read?.text;
  return typeof text === 'string' ? text : undefined;
}

function assertPaneId(paneId: string): void {
  if (!isHerdrPaneId(paneId)) throw new HerdrError('invalid_request', INVALID_PANE_MESSAGE);
}

function assertPrompt(text: string): void {
  if (text.trim() === '') throw new HerdrError('invalid_request', INVALID_PROMPT_MESSAGE);
  if (Buffer.byteLength(text, 'utf8') > HERDR_PROMPT_MAX_BYTES) {
    throw new HerdrError('invalid_request', PROMPT_TOO_LARGE_MESSAGE);
  }
}

/**
 * The PowerShell line a new tab runs to reopen a session whose pane the sleep closed. Every value
 * sits in a single-quoted string with `'` doubled, so a path or prompt cannot break out of it; the
 * prompt is one line without control characters (assertWakePrompt).
 */
export function closedWakeCommand(stub: string, plan: ClosedSleepWake, prompt?: string): string {
  const quote = (text: string): string => `'${text.replace(/'/g, "''")}'`;
  return [
    '&',
    quote(stub),
    '-Agent',
    plan.agent,
    '-File',
    quote(plan.file),
    '-Ngay',
    ...(plan.fresh ? ['-Fresh'] : []),
    ...(prompt !== undefined ? ['-Prompt', quote(prompt)] : []),
  ].join(' ');
}

function assertWakePrompt(text: string): void {
  if (text.trim() === '') throw new HerdrError('invalid_request', INVALID_WAKE_PROMPT_MESSAGE);
  if (text.length > WAKE_PROMPT_MAX_CHARS) {
    throw new HerdrError('invalid_request', WAKE_PROMPT_TOO_LONG_MESSAGE);
  }
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      throw new HerdrError('invalid_request', WAKE_PROMPT_ONE_LINE_MESSAGE);
    }
  }
}

function assertLines(lines: number): void {
  if (!Number.isInteger(lines) || lines < 1 || lines > HERDR_MAX_READ_LINES) {
    throw new HerdrError('invalid_request', INVALID_LINES_MESSAGE);
  }
}

/** Finds an agent's `agent.list` entry by pane; a pane with no agent is reported as not found. */
function findListedAgent(result: unknown, paneId: string): unknown {
  const list = jsonField(result, 'agents');
  if (!Array.isArray(list)) throw new HerdrError('herdr_rejected', INVALID_REPLY_MESSAGE);
  const listed = (list as readonly unknown[]).find(
    (entry) => jsonField(entry, 'pane_id') === paneId,
  );
  if (listed === undefined) throw new HerdrError('agent_not_found', AGENT_NOT_FOUND_MESSAGE);
  return listed;
}

/**
 * The cwd of the foreground process where the agent runs. An omp process wins over other
 * foreground processes, such as the shell that started it.
 */
function foregroundProcessCwd(result: unknown): string | undefined {
  const processes = jsonField(jsonField(result, 'process_info'), 'foreground_processes');
  if (!Array.isArray(processes)) return undefined;
  let fallback: string | undefined;
  for (const entry of processes as readonly unknown[]) {
    const cwd = nonEmptyString(jsonField(entry, 'cwd'));
    if (cwd === undefined) continue;
    if (OMP_PROCESS_PATTERN.test(executableBase(entry))) return cwd;
    fallback ??= cwd;
  }
  return fallback;
}

/** Last path segment of the process name, or of argv[0] when the name is missing. */
function executableBase(entry: unknown): string {
  const argv = jsonField(entry, 'argv');
  const first = Array.isArray(argv) ? (argv as readonly unknown[])[0] : undefined;
  const command = nonEmptyString(jsonField(entry, 'name')) ?? nonEmptyString(first) ?? '';
  return command.split(/[\\/]/).pop() ?? '';
}

/** One spelling per directory: slash style, trailing separators, and drive-letter case do not matter. */
function comparablePath(value: string): string {
  const unified = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(unified) ? unified.toLowerCase() : unified;
}

function assertAgentName(name: string): void {
  if (!HERDR_AGENT_NAME_PATTERN.test(name)) {
    throw new HerdrError('invalid_request', INVALID_AGENT_NAME_MESSAGE);
  }
}

/**
 * Builds the board's view of one agent. `cwd` is where its process runs now; `launchCwd` is
 * the directory herdr started it in, reported only when it differs.
 */
function composeAgentInfo(facts: AgentInfoFacts): BoardAgentInfo {
  const cwd = facts.foregroundCwd ?? facts.rosterCwd;
  const roster = facts.rosterCwd;
  const launchCwd =
    roster !== undefined && cwd !== undefined && comparablePath(roster) !== comparablePath(cwd)
      ? roster
      : undefined;
  const base: BoardAgentInfo = {
    collectedFrom: 'herdr',
    collectedAt: facts.collectedAt,
    ...(cwd === undefined ? {} : { cwd }),
    ...(launchCwd === undefined ? {} : { launchCwd }),
  };
  if (!('summary' in facts.read)) return { ...base, note: facts.read.note };
  return {
    ...base,
    ...ompAgentFields(facts.read.summary),
    collectedFrom: 'transcript',
    ...(facts.read.summary.truncated ? { note: NOTE_TRUNCATED } : {}),
  };
}
