/**
 * Cloud control: the two things the board may DO to a cloud machine, both through the InstaBox
 * CLI already signed in on this computer (no new credential, no port opened on the machine):
 *
 *  - openTerminal: a local PTY running `instabox ssh <machine> -- -tt ... tmux attach -t <session>`,
 *    registered with the board's PtySessionManager so the existing `/terminal/:id` socket (token +
 *    Origin checked) carries it. Screen bytes flow only while that socket is open.
 *  - cleanTask: removes a finished or abandoned task again (taskClean.ts), refusing while it holds unsaved work.
 *  - createTask: `cloud-giao <repo> <slug> <machine>` on the machine (installed by the cloud bundle):
 *    a worktree on branch `cloud/<machine>-<slug>` and Claude started in tmux session `<slug>`.
 *    The prompt travels on stdin, never on a command line.
 *
 * Every name is validated against a strict pattern before it reaches an argv, and argv is passed
 * without a local shell; on the machine, ssh/exec join it into a shell line, which is why the
 * patterns allow no quoting or shell metacharacters.
 */

import { execFile, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import type { GitRunner } from '../ledger/git.js';
import type { ProcessResult } from '../ledger/processRunner.js';
import {
  formatProjectComment,
  PROJECT_COMMENT_MAX_LENGTH,
  PROJECT_COMMENT_SNIPPET_MAX_LENGTH,
} from '../projects/comments.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import {
  FLEET_ACCOUNT_CACHE_MS,
  FLEET_ASK_CACHE_MS,
  FLEET_ASK_PEEK_TIMEOUT_S,
  FLEET_DIFF_MAX_BYTES,
  FLEET_DIFF_NEW_FILE_BYTES,
  FLEET_DIFF_NEW_FILES,
  FLEET_FORWARD_IDLE_MS,
  FLEET_FORWARD_READY_MS,
  FLEET_HISTORY_LINES,
  FLEET_HISTORY_MAX_BYTES,
  FLEET_INSTABOX_TIMEOUT_MS,
  FLEET_LAVISH_KEY,
  FLEET_LAVISH_REMOTE_PORT,
  FLEET_MACHINE_NAME,
  FLEET_PROMPT_MAX,
  FLEET_PROMPT_PEEK_TIMEOUT_S,
  FLEET_REPO_PATH,
  FLEET_SESSION_NAME,
  FLEET_TASK_ENGINES,
  FLEET_TASK_REPOS,
  FLEET_TASK_SLUG,
  FLEET_TERMINAL_ID_BASE,
} from './constants.js';
import type { FleetHubMachine, FleetHubResponse } from './hubClient.js';
import { listedMachines, parseTmuxPanes, TMUX_PANES_SCRIPT } from './hubFallback.js';
import { IMAGE_UPLOAD_BASE64, IMAGE_UPLOAD_NAME, imageUploadScript } from './imageUpload.js';
import { LAVISH_DELETE_SCRIPT } from './lavishDelete.js';
import { PANE_PEEK_SCRIPT, parsePanePeek } from './paneAsk.js';
import { PANE_PROMPTS_SCRIPT, parsePanePrompts } from './panePrompts.js';
import { SESSION_RESTART_SCRIPT } from './sessionRestart.js';
import { TASK_CLEAN_SCRIPT } from './taskClean.js';

export type FleetTaskRepo = (typeof FLEET_TASK_REPOS)[number];
export type FleetTaskEngine = (typeof FLEET_TASK_ENGINES)[number];

export class CloudControlError extends Error {
  constructor(
    readonly code: 'bad_input' | 'no_machine' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export interface InstaboxResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CloudControlDeps {
  /** Account config homes (each used as XDG_CONFIG_HOME), default account first. */
  listConfigHomes(): Promise<string[]>;
  run(args: readonly string[], configHome: string, input?: string): Promise<InstaboxResult>;
  /** The executable and leading args that start the InstaBox CLI. */
  readonly launcher: { readonly file: string; readonly args: readonly string[] };
  now(): number;
  /** Start `instabox port-forward <machine> <local>:<remote>`; resolves once the local port accepts connections. */
  forward(machine: string, remotePort: number, configHome: string): Promise<PortForward>;
}

export interface PortForward {
  readonly localPort: number;
  readonly alive: () => boolean;
  stop(): void;
}

export function isTaskRepo(value: unknown): value is FleetTaskRepo {
  return typeof value === 'string' && (FLEET_TASK_REPOS as readonly string[]).includes(value);
}

export function isTaskEngine(value: unknown): value is FleetTaskEngine {
  return typeof value === 'string' && (FLEET_TASK_ENGINES as readonly string[]).includes(value);
}

export class CloudControl {
  #accounts: { readonly at: number; readonly byMachine: Map<string, string> } | null = null;
  readonly #terminalIds = new Map<string, number>();
  readonly #forwards = new Map<string, { forward: PortForward; idle: NodeJS.Timeout }>();
  #nextTerminalId = FLEET_TERMINAL_ID_BASE;
  #fallback: { readonly at: number; readonly response: FleetHubResponse } | null = null;

  constructor(private readonly deps: CloudControlDeps = defaultDeps()) {}

  async openTerminal(ptyManager: PtySessionManager, machine: string, session: string): Promise<number> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_SESSION_NAME.test(session)) {
      throw new CloudControlError('bad_input', 'invalid name');
    }
    const home = await this.#wake(machine);
    const key = `${machine}/${session}`;
    const existing = this.#terminalIds.get(key);
    if (existing !== undefined && ptyManager.has(existing)) return existing;
    const terminalId = existing ?? ++this.#nextTerminalId;
    this.#terminalIds.set(key, terminalId);
    ptyManager.create({
      agentId: terminalId,
      command: this.deps.launcher.file,
      args: [
        ...this.deps.launcher.args,
        'ssh',
        machine,
        '--',
        '-tt',
        'env',
        'TERM=xterm-256color',
        'tmux',
        'attach',
        '-t',
        session,
      ],
      cwd: os.homedir(),
      env: { XDG_CONFIG_HOME: home },
    });
    return terminalId;
  }

  async createTask(machine: string, repo: unknown, slug: string, prompt: string, engine: unknown = 'claude'): Promise<string> {
    if (
      !FLEET_MACHINE_NAME.test(machine) ||
      !isTaskRepo(repo) ||
      !isTaskEngine(engine) ||
      !FLEET_TASK_SLUG.test(slug) ||
      prompt.trim() === '' ||
      prompt.length > FLEET_PROMPT_MAX
    ) {
      throw new CloudControlError('bad_input', 'invalid task');
    }
    const home = await this.#wake(machine);
    // Claude keeps the old argv. omp is an explicit flag: a cloud-giao that predates it refuses with code 2
    // instead of quietly starting Claude.
    const engineArgs = engine === 'claude' ? [] : ['--engine', engine];
    const result = await this.deps.run(
      ['exec', machine, '--timeout', '300', '--stdin', '--', 'cloud-giao', ...engineArgs, repo, slug, machine],
      home,
      prompt,
    );
    if (result.code !== 0 || !/^OK /m.test(result.stdout)) {
      const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean).pop();
      if (engine !== 'claude' && result.code === 2 && said?.startsWith('Repo phai la')) {
        throw new CloudControlError('failed', `Máy ${machine} chưa hỗ trợ ${engine}: cloud-giao còn bản cũ, cần đẩy bản mới (fleet/cloud-giao) lên máy bằng dong-bo-cloud`);
      }
      throw new CloudControlError('failed', said ?? `cloud-giao exit ${result.code}`);
    }
    return slug;
  }

  /** Removes a task cloud-giao started (tmux, worktrees, branch, ledger entry); the machine refuses while anything in it is unsaved. */
  async cleanTask(machine: string, slug: string, pushFirst = false): Promise<void> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_TASK_SLUG.test(slug)) {
      throw new CloudControlError('bad_input', 'invalid task');
    }
    const home = await this.#wake(machine);
    const result = await this.deps.run(['exec', machine, '--timeout', '120', '--stdin', '--', 'bash', '-s', '--', slug, ...(pushFirst ? ['push'] : [])], home, TASK_CLEAN_SCRIPT);
    if (result.code !== 0 || !/^OK /m.test(result.stdout)) {
      const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean).pop();
      throw new CloudControlError('failed', said ?? `clean exit ${result.code}`);
    }
  }

  /** Keeps one prompt image on the machine and returns its path there, so an agent running on it can open the image. */
  async uploadImage(machine: string, fileName: string, dataBase64: string): Promise<string> {
    if (!FLEET_MACHINE_NAME.test(machine) || !IMAGE_UPLOAD_NAME.test(fileName) || !IMAGE_UPLOAD_BASE64.test(dataBase64)) {
      throw new CloudControlError('bad_input', 'invalid image');
    }
    const home = await this.#wake(machine);
    const result = await this.deps.run(['exec', machine, '--timeout', '60', '--stdin', '--', 'bash', '-s', '--', fileName], home, imageUploadScript(dataBase64));
    const path = /^OK (\S+)$/m.exec(result.stdout)?.[1];
    if (result.code !== 0 || path === undefined) {
      const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean).pop();
      throw new CloudControlError('failed', said ?? `image upload exit ${result.code}`);
    }
    return path;
  }

  /** Restarts the Claude of one tmux session on the same conversation (`claude --resume`); the machine refuses while Claude looks busy. */
  async restartSession(machine: string, slug: string): Promise<void> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_TASK_SLUG.test(slug)) {
      throw new CloudControlError('bad_input', 'invalid session');
    }
    const home = await this.#wake(machine);
    const result = await this.deps.run(['exec', machine, '--timeout', '90', '--stdin', '--', 'bash', '-s', '--', slug], home, SESSION_RESTART_SCRIPT);
    if (result.code !== 0 || !/^OK /m.test(result.stdout)) {
      const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean).pop();
      throw new CloudControlError('failed', said ?? `restart exit ${result.code}`);
    }
  }

  /** Deletes one Lavish page (ends its session and removes the file); the agent that wrote it can write it again. */
  async deleteLavish(machine: string, key: string): Promise<void> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_LAVISH_KEY.test(key)) {
      throw new CloudControlError('bad_input', 'invalid lavish session');
    }
    const home = await this.#wake(machine);
    const result = await this.deps.run(['exec', machine, '--timeout', '60', '--stdin', '--', 'bash', '-s', '--', key], home, LAVISH_DELETE_SCRIPT);
    if (result.code !== 0 || !/^OK /m.test(result.stdout)) {
      const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').filter(Boolean).pop();
      throw new CloudControlError('failed', said ?? `lavish delete exit ${result.code}`);
    }
  }

  /**
   * A local URL for one Lavish session on `machine`. One port-forward per machine, reused while alive and
   * closed after {@link FLEET_FORWARD_IDLE_MS} without a new open; Lavish itself stays on the machine's loopback.
   */
  async openLavish(machine: string, key: string): Promise<string> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_LAVISH_KEY.test(key)) {
      throw new CloudControlError('bad_input', 'invalid lavish session');
    }
    let entry = this.#forwards.get(machine);
    if (!entry || !entry.forward.alive()) {
      const home = await this.#wake(machine);
      const forward = await this.deps.forward(machine, FLEET_LAVISH_REMOTE_PORT, home);
      entry = { forward, idle: setTimeout(() => undefined, 0) };
      this.#forwards.set(machine, entry);
    }
    clearTimeout(entry.idle);
    const current = entry;
    current.idle = setTimeout(() => {
      current.forward.stop();
      if (this.#forwards.get(machine) === current) this.#forwards.delete(machine);
    }, FLEET_FORWARD_IDLE_MS);
    current.idle.unref?.();
    return `http://127.0.0.1:${current.forward.localPort}/session/${key}`;
  }

  /** Close every port-forward (board shutdown). */
  dispose(): void {
    for (const { forward, idle } of this.#forwards.values()) {
      clearTimeout(idle);
      forward.stop();
    }
    this.#forwards.clear();
  }

  /**
   * Read-only git view of one repository on `machine`: status, commits and diffstat against origin/main, and the
   * uncommitted diff. The caller has already checked that the machine reported this path.
   */
  async readDiff(machine: string, repoPath: string): Promise<{ text: string; truncated: boolean }> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_REPO_PATH.test(repoPath)) {
      throw new CloudControlError('bad_input', 'invalid repository path');
    }
    const home = await this.#wake(machine);
    const script = [
      `cd '${repoPath}' || exit 3`,
      'echo "### git status"; git status --short --branch',
      'echo; echo "### Commit tren nhanh, chua co tren origin/main"; git log --oneline origin/main..HEAD | head -50',
      'git diff --stat origin/main...HEAD | tail -40',
      'echo; echo "### Thay doi chua commit"; git diff HEAD --stat; echo; git diff HEAD',
      // New files are not in `git diff HEAD`: show the first ones (text only, each cut) as additions.
      'echo; echo "### File moi chua commit"',
      `git ls-files --others --exclude-standard | head -${FLEET_DIFF_NEW_FILES} | while IFS= read -r f; do ` +
        `echo "### File mới: $f"; if grep -Iq . "$f" 2>/dev/null; then head -c ${FLEET_DIFF_NEW_FILE_BYTES} "$f" | sed 's/^/+/'; echo; ` +
        'else echo "(file nhi phan hoac rong)"; fi; done',
    ].join('; ');
    const result = await this.deps.run(
      ['exec', machine, '--timeout', '120', '--', `{ ${script}; } 2>&1 | head -c ${FLEET_DIFF_MAX_BYTES + 1}`],
      home,
    );
    if (result.code !== 0) throw new CloudControlError('failed', result.stdout.trim().split('\n').pop() ?? 'git failed');
    const truncated = Buffer.byteLength(result.stdout) > FLEET_DIFF_MAX_BYTES;
    return { text: truncated ? result.stdout.slice(0, FLEET_DIFF_MAX_BYTES) : result.stdout, truncated };
  }

  /**
   * The tmux scrollback of one session, read once so the board can scroll it locally (every step of a live
   * scroll costs a full network round trip). Wrapped lines are joined (`-J`) so the board re-wraps to its own width.
   */
  async readHistory(machine: string, session: string): Promise<{ text: string; truncated: boolean }> {
    if (!FLEET_MACHINE_NAME.test(machine) || !FLEET_SESSION_NAME.test(session)) {
      throw new CloudControlError('bad_input', 'invalid session');
    }
    const home = await this.#wake(machine);
    // tmux's own status is checked before the pipe: `tmux ... | tail` would report tail's success for a missing session.
    const script =
      `out=$(tmux capture-pane -p -e -J -S -${FLEET_HISTORY_LINES} -t '${session}' 2>&1) || { echo "$out"; exit 1; }; ` +
      `printf '%s\\n' "$out" | tail -c ${FLEET_HISTORY_MAX_BYTES + 1}`;
    const result = await this.deps.run(['exec', machine, '--timeout', '60', '--', script], home);
    if (result.code !== 0) throw new CloudControlError('failed', result.stdout.trim().split('\n').pop() ?? 'history failed');
    const bytes = Buffer.from(result.stdout);
    if (bytes.length <= FLEET_HISTORY_MAX_BYTES) return { text: result.stdout, truncated: false };
    // Keep the newest bytes and start on a whole line: the cut may fall inside a line or an escape sequence.
    const kept = bytes.subarray(bytes.length - FLEET_HISTORY_MAX_BYTES).toString();
    return { text: kept.slice(kept.indexOf('\n') + 1), truncated: true };
  }

  /** Build a GitRunner pinned to one reported cloud account; engine calls run with argv-only git commands. */
  async gitRunner(machine: string): Promise<GitRunner> {
    if (!FLEET_MACHINE_NAME.test(machine)) throw new CloudControlError('bad_input', 'invalid machine');
    const home = await this.#wake(machine);
    return {
      run: async (cwd, args, options) => {
        if (
          !FLEET_REPO_PATH.test(cwd) ||
          args.length === 0 ||
          args.length > 128 ||
          args.some((argument) => argument.includes('\0')) ||
          !Number.isFinite(options.timeoutMs) ||
          options.timeoutMs <= 0 ||
          !Number.isSafeInteger(options.maxBytes) ||
          options.maxBytes <= 0
        ) {
          return { ok: false, code: 1, stdout: '', stderr: 'invalid remote git request', timedOut: false, truncated: false };
        }
        const command = `git --no-optional-locks -C ${shellQuote(cwd)} ${args.map(shellQuote).join(' ')}`;
        if (Buffer.byteLength(command) > 32_768) {
          return { ok: false, code: 1, stdout: '', stderr: 'remote git request too large', timedOut: false, truncated: false };
        }
        try {
          const result = await this.deps.run(
            ['exec', machine, '--timeout', String(Math.max(1, Math.ceil(options.timeoutMs / 1_000))), '--', command],
            home,
          );
          const output = Buffer.from(result.stdout, 'utf8');
          const truncated = output.length > options.maxBytes;
          const stdout = truncated ? output.subarray(0, options.maxBytes).toString('utf8') : result.stdout;
          const timedOut = result.code === 124;
          return {
            ok: options.okCodes.includes(result.code) && !timedOut,
            code: result.code,
            stdout,
            stderr: result.stderr.slice(0, 4_096),
            timedOut,
            truncated,
          } satisfies ProcessResult;
        } catch (error) {
          return {
            ok: false,
            code: null,
            stdout: '',
            stderr: error instanceof Error ? error.message.slice(0, 4_096) : 'remote git failed',
            timedOut: false,
            truncated: false,
          };
        }
      },
    };
  }

  /** Send an anchored comment through the reported tmux session; only the fixed tmux script reaches the shell. */
  async sendDiffComment(
    machine: string,
    session: string,
    comment: { readonly file: string; readonly line: number; readonly snippet: string; readonly content: string },
  ): Promise<void> {
    const content = comment.content.trim();
    if (
      !FLEET_MACHINE_NAME.test(machine) ||
      !FLEET_SESSION_NAME.test(session) ||
      comment.file.trim() === '' ||
      comment.file.length > 500 ||
      !Number.isSafeInteger(comment.line) ||
      comment.line < 1 ||
      comment.snippet.length > PROJECT_COMMENT_SNIPPET_MAX_LENGTH ||
      content === '' ||
      content.length > PROJECT_COMMENT_MAX_LENGTH
    ) {
      throw new CloudControlError('bad_input', 'invalid diff comment');
    }
    const text = formatProjectComment(comment.file, comment.line, comment.snippet, content);
    const home = await this.#wake(machine);
    const buffer = `board-${randomUUID()}`;
    const script =
      `tmux load-buffer -b '${buffer}' - && ` +
      `{ tmux paste-buffer -b '${buffer}' -t '${session}'; status=$?; ` +
      `tmux delete-buffer -b '${buffer}'; test "$status" -eq 0; } && ` +
      `tmux send-keys -t '${session}' Enter`;
    const result = await this.deps.run(
      ['exec', machine, '--timeout', '30', '--stdin', '--', script],
      home,
      text,
    );
    if (result.code !== 0) {
      throw new CloudControlError('failed', result.stdout.trim().split('\n').pop() ?? 'tmux comment failed');
    }
  }

  /**
   * The sessions of `machine` whose pane shows a menu waiting for the user, each with what it asks. Reads only: it never
   * starts or wakes the machine (a sleeping one has nothing asking), and any failure reads as "none asking".
   */
  async peekAsking(machine: string, sessions: readonly string[]): Promise<Map<string, string>> {
    if (!FLEET_MACHINE_NAME.test(machine) || !sessions.every((name) => FLEET_SESSION_NAME.test(name))) return new Map();
    try {
      const home = await this.#accountFor(machine);
      const result = await this.deps.run(['exec', machine, '--timeout', String(FLEET_ASK_PEEK_TIMEOUT_S), '--', PANE_PEEK_SCRIPT], home);
      if (result.code !== 0) return new Map();
      const wanted = new Set(sessions);
      return new Map([...parsePanePeek(result.stdout)].filter(([name]) => wanted.has(name)));
    } catch {
      return new Map();
    }
  }

  /**
   * The last prompts of every tmux session of `machine`, by session name. Reads only: it never wakes the machine, and a
   * failure rejects so the caller keeps its previous answer.
   */
  async peekPrompts(machine: string): Promise<Map<string, string[]>> {
    if (!FLEET_MACHINE_NAME.test(machine)) return new Map();
    const home = await this.#accountFor(machine);
    const result = await this.deps.run(['exec', machine, '--timeout', String(FLEET_PROMPT_PEEK_TIMEOUT_S), '--stdin', '--', 'bash', '-s'], home, PANE_PROMPTS_SCRIPT);
    if (result.code !== 0) throw new CloudControlError('failed', `prompt read exit ${result.code}`);
    return parsePanePrompts(result.stdout);
  }

  /**
   * What the machines say when the hub cannot be reached: the tmux sessions of every machine InstaBox reports
   * running, read over exec. It never wakes a sleeping machine, a failing machine is left out, and the answer is
   * kept for FLEET_ASK_CACHE_MS so a polling board does not turn into a burst of execs.
   */
  async readRunningTmux(): Promise<FleetHubResponse> {
    if (this.#fallback !== null && this.deps.now() - this.#fallback.at < FLEET_ASK_CACHE_MS) return this.#fallback.response;
    const homes = await this.deps.listConfigHomes();
    const listings = await Promise.all(homes.map((home) => this.deps.run(['ls', '--json'], home).catch(() => null)));
    const owner = new Map<string, string>();
    const asleep = new Set<string>();
    homes.forEach((home, index) => {
      for (const { name, running } of listedMachines(listings[index]?.stdout ?? '')) {
        if (!FLEET_MACHINE_NAME.test(name) || owner.has(name) || asleep.has(name)) continue;
        if (running) owner.set(name, home);
        else asleep.add(name);
      }
    });
    const nowMs = this.deps.now();
    // A sleeping machine is listed as never seen (received_at 0 reads as "stale"): nothing is run on it.
    const sleepers = [...asleep].map((name): FleetHubMachine => ({ agent_id: name, received_at: 0, sessions: [], repos: [], tmux: [] }));
    const answers = await Promise.all(
      [...owner].map(async ([name, home]): Promise<FleetHubMachine | null> => {
        try {
          const result = await this.deps.run(['exec', name, '--timeout', String(FLEET_PROMPT_PEEK_TIMEOUT_S), '--', TMUX_PANES_SCRIPT], home);
          if (result.code !== 0) return null;
          return { agent_id: name, received_at: nowMs, sessions: [], repos: [], tmux: parseTmuxPanes(result.stdout, nowMs / 1000) };
        } catch {
          return null;
        }
      }),
    );
    const response: FleetHubResponse = { now: nowMs, machines: [...answers.filter((machine) => machine !== null), ...sleepers] };
    this.#fallback = { at: nowMs, response };
    return response;
  }

  /** Starts a paused or suspended machine on the user's request; fails only when InstaBox accepted neither `start` nor `wake`. */
  async wakeMachine(machine: string): Promise<void> {
    if (!FLEET_MACHINE_NAME.test(machine)) throw new CloudControlError('bad_input', 'invalid machine');
    const home = await this.#accountFor(machine);
    const answers = await Promise.all([
      this.deps.run(['start', machine], home).catch(() => undefined),
      this.deps.run(['wake', machine], home).catch(() => undefined),
    ]);
    if (answers.every((answer) => answer?.code !== 0)) {
      const said = answers.map((answer) => `${answer?.stdout ?? ''}\n${answer?.stderr ?? ''}`).join('\n').trim().split('\n').filter(Boolean).pop();
      throw new CloudControlError('failed', said ?? 'instabox start/wake failed');
    }
  }

  /** The account home owning `machine`, after asking InstaBox to start/wake it (both no-ops when running). */
  async #wake(machine: string): Promise<string> {
    const home = await this.#accountFor(machine);
    // Both are no-ops on a running machine; `start` covers a suspended one, `wake` an auto-paused one.
    await Promise.all([
      this.deps.run(['start', machine], home).catch(() => undefined),
      this.deps.run(['wake', machine], home).catch(() => undefined),
    ]);
    return home;
  }

  async #accountFor(machine: string): Promise<string> {
    const fresh = this.#accounts && this.deps.now() - this.#accounts.at < FLEET_ACCOUNT_CACHE_MS;
    if (!fresh || !this.#accounts?.byMachine.has(machine)) {
      const byMachine = new Map<string, string>();
      // One `ls` per signed-in account, in parallel (each takes 3-5 s); the first account listing a name owns it.
      const homes = await this.deps.listConfigHomes();
      const listings = await Promise.all(homes.map((home) => this.deps.run(['ls', '--json'], home).catch(() => null)));
      homes.forEach((home, index) => {
        for (const name of machineNames(listings[index]?.stdout ?? '')) {
          if (!byMachine.has(name)) byMachine.set(name, home);
        }
      });
      this.#accounts = { at: this.deps.now(), byMachine };
    }
    const home = this.#accounts?.byMachine.get(machine);
    if (home === undefined) throw new CloudControlError('no_machine', machine);
    return home;
  }
}

export function machineNames(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((box: unknown) =>
      box && typeof box === 'object' && 'name' in box && typeof box.name === 'string' ? [box.name] : [],
    );
  } catch {
    return [];
  }
}
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function defaultLauncher(): { file: string; args: string[] } {
  const script =
    process.env.PIXEL_AGENTS_INSTABOX ??
    (process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'instabox', 'bin', 'instabox.mjs')
      : null);
  return script ? { file: process.execPath, args: [script] } : { file: 'instabox', args: [] };
}

function defaultDeps(): CloudControlDeps {
  const launcher = defaultLauncher();
  return {
    launcher,
    now: () => Date.now(),
    async listConfigHomes() {
      const extra = path.join(os.homedir(), '.config-instabox');
      const names = await readdir(extra, { withFileTypes: true }).catch(() => []);
      return [
        path.join(os.homedir(), '.config'),
        ...names.filter((entry) => entry.isDirectory()).map((entry) => path.join(extra, entry.name)),
      ];
    },
    async forward(machine, remotePort, configHome) {
      const localPort = await freePort();
      // The CLI spawns `ssh` itself: stopping must end the whole tree, or ssh keeps the port open.
      const child = spawn(
        launcher.file,
        [...launcher.args, 'port-forward', machine, `${localPort}:${remotePort}`],
        {
          env: { ...process.env, XDG_CONFIG_HOME: configHome },
          stdio: 'ignore',
          windowsHide: true,
          detached: process.platform !== 'win32',
        },
      );
      const stopTree = (): void => {
        if (exited || child.pid === undefined) return;
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill();
          }
        }
      };
      let exited = false;
      child.on('exit', () => {
        exited = true;
      });
      const deadline = Date.now() + FLEET_FORWARD_READY_MS;
      while (!(await accepts(localPort))) {
        if (exited || Date.now() > deadline) {
          stopTree();
          throw new CloudControlError('failed', 'port-forward did not start');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return { localPort, alive: () => !exited, stop: stopTree };
    },
    run(args, configHome, input) {
      const started = Date.now();
      return new Promise((resolve) => {
        const child = execFile(
          launcher.file,
          [...launcher.args, ...args],
          {
            env: { ...process.env, XDG_CONFIG_HOME: configHome },
            timeout: FLEET_INSTABOX_TIMEOUT_MS,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          },
          (error, stdout, stderr) => {
            const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
            console.log(`[Fleet] instabox ${args[0]} ${args[1] ?? ''}: ${Date.now() - started} ms, exit ${code}`);
            resolve({ code, stdout: String(stdout), stderr: String(stderr) });
          },
        );
        if (input !== undefined) child.stdin?.end(input);
        else child.stdin?.end();
      });
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}
