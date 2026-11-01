import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardAgentEngine, HerdrAgentEngine, WrapperAgentEngine } from '../../core/src/agentEngines.js';
import type { SubmitPromptInput } from '../../core/src/company.js';
import type { CompanySessionSummary, CompanySnapshot, HerdrAgentsMessage, ProjectSessionStartMessage, ProjectTreeNode } from '../../core/src/messages.js';
import type { CompanyCoordinator } from '../src/company/companyCoordinator.js';
import { type ProjectSessionServices, startProjectSession } from '../src/projects/newSession.js';
import { createProjectSessionRuntime } from '../src/projects/newSessionRuntime.js';
import { createProjectSessionWorktree, taskSlug } from '../src/projects/projectSessionWorktree.js';
import type { ProjectStore } from '../src/projects/projectStore.js';

let root: string;
let repo: string;
let bare: string;

/** A folder's coordinator as the session runtime uses it; `native-1` is the omp session board chat `board-1` ran. */
function boardCoordinator(sessions: CompanySessionSummary[] = []) {
  return {
    openNewChat: vi.fn(async () => 'board-session'),
    submitPrompt: vi.fn(async (_input: SubmitPromptInput) => ({}) as never),
    sessionForNative: vi.fn((nativeSessionId: string) => (nativeSessionId === 'native-1' ? 'board-1' : null)),
    snapshot: () => ({ sessions }) as unknown as CompanySnapshot,
    controlSession: vi.fn(async () => undefined),
  } satisfies Pick<CompanyCoordinator, 'openNewChat' | 'submitPrompt' | 'sessionForNative' | 'snapshot' | 'controlSession'>;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createRepository(): void {
  fs.mkdirSync(repo);
  fs.mkdirSync(bare);
  git(root, 'init', '--bare', '-q', bare);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'repo\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'initial');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-qu', 'origin', 'main');
}

function createServices(overrides: Partial<ProjectSessionServices> = {}) {
  return {
    effectiveSettings: vi.fn(async () => ({})),
    runGit: async (file: string, argv: readonly string[], cwd: string) => {
      try {
        const stdout = execFileSync(file, [...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
      } catch (error) {
        const failure = error as { status?: number; stderr?: Buffer };
        return { code: failure.status ?? 1, stdout: '', stderr: failure.stderr?.toString() ?? '' };
      }
    },
    openChat: vi.fn(async () => 'omp-id'),
    startAgent: vi.fn(async ({ kind }: { kind: BoardAgentEngine | HerdrAgentEngine }) => `${kind}-pane`),
    startCli: vi.fn(async ({ kind }: { kind: WrapperAgentEngine }) => `${kind}-pane`),
    runSetupScript: vi.fn(async () => ({ code: 0, stderr: '' })),
    ...overrides,
    findAgent: overrides.findAgent ?? vi.fn((_name: string): { paneId: string; cwd: string } | undefined => undefined),
  } satisfies ProjectSessionServices;
}

function tree(): { nodes: ProjectTreeNode[] } {
  return {
    nodes: [
      { id: 'folder', kind: 'folder', name: 'Project', path: root },
      { id: 'repo', parentId: 'folder', kind: 'repository', name: 'repo', path: repo },
      { id: repo, parentId: 'repo', kind: 'checkout', name: 'repo', path: repo },
      { id: 'worktree', parentId: 'repo', kind: 'checkout', name: 'branch', path: path.join(root, 'repo.worktrees', 'branch') },
    ],
  };
}

function request(
  engine: ProjectSessionStartMessage['engine'],
  worktree: ProjectSessionStartMessage['worktree'],
  nodeId = 'repo',
): ProjectSessionStartMessage {
  return {
    type: 'projectSessionStart',
    requestId: 'request-1',
    nodeId,
    engine,
    worktree,
    taskName: 'Sửa lỗi đăng nhập',
    initialPrompt: 'Hãy sửa lỗi đăng nhập.',
  };
}

function deps(services: ProjectSessionServices) {
  return {
    store: {} as ProjectStore,
    loadTree: async () => tree(),
    services,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-session-'));
  repo = path.join(root, 'repo');
  bare = path.join(root, 'origin.git');
  createRepository();
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('project session start', () => {
  it('creates a slugged worktree alongside the repo from origin/main', async () => {
    const result = await createProjectSessionWorktree({ repo, taskName: 'Sửa lỗi đăng nhập!', run: async (file, argv, cwd) => {
      try {
        const stdout = execFileSync(file, [...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
      } catch (error) {
        const failure = error as { status?: number; stderr?: Buffer };
        return { code: failure.status ?? 1, stdout: '', stderr: failure.stderr?.toString() ?? '' };
      }
    } });
    expect(result.path).toBe(path.join(root, 'repo.worktrees', 'sua-loi-dang-nhap'));
    expect(git(result.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('project/sua-loi-dang-nhap');
  });

  it('adds a suffix when a task slug already exists', async () => {
    const runner = async (file: string, argv: readonly string[], cwd: string) => {
      try {
        const stdout = execFileSync(file, [...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
      } catch (error) {
        const failure = error as { status?: number; stderr?: Buffer };
        return { code: failure.status ?? 1, stdout: '', stderr: failure.stderr?.toString() ?? '' };
      }
    };
    const first = await createProjectSessionWorktree({ repo, taskName: 'Review', run: runner });
    const second = await createProjectSessionWorktree({ repo, taskName: 'Review', run: runner });
    expect(first.path).toBe(path.join(root, 'repo.worktrees', 'review'));
    expect(second.path).toBe(path.join(root, 'repo.worktrees', 'review-2'));
  });

  it.each([
    ['omp', 'omp-id', 'openChat'],
    ['claude', 'claude-pane', 'startAgent'],
    ['agy', 'agy-pane', 'startAgent'],
    ['codex', 'codex-pane', 'startCli'],
    ['pi', 'pi-pane', 'startCli'],
  ] as const)('starts %s with the selected checkout cwd', async (engine, sessionId, runnerName) => {
    const services = createServices();
    const result = await startProjectSession(request(engine, 'shared'), deps(services));
    expect(result).toMatchObject({ ok: true, sessionId, checkout: repo });
    expect(services[runnerName]).toHaveBeenCalledWith(expect.objectContaining({ cwd: repo }));
  });
  it('uses the exact checkout node selected in the tree', async () => {
    const checkout = path.join(root, 'repo.worktrees', 'branch');
    const services = createServices();
    const result = await startProjectSession(request('claude', 'shared', 'worktree'), deps(services));
    expect(result).toMatchObject({ sessionId: 'claude-pane', checkout });
    expect(services.startAgent).toHaveBeenCalledWith(expect.objectContaining({ cwd: checkout, kind: 'claude' }));
  });

  it('opens the live agent of the same name instead of starting a second one, even after losing a start race', async () => {
    const existing = path.join(root, 'repo.worktrees', 'claude-sua-loi-dang-nhap');
    const startAgent = vi.fn(async () => 'never');
    const findAgent = vi.fn(() => ({ paneId: 'wA:p14', cwd: existing }));
    const result = await startProjectSession(request('claude', 'separate'), deps(createServices({ startAgent, findAgent })));
    expect(result).toMatchObject({ ok: true, sessionId: 'wA:p14', checkout: existing });
    expect(startAgent).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'repo.worktrees'))).toBe(false);

    // Both starts passed the check; herdr refuses the second name, which then opens the winner.
    let live: { paneId: string; cwd: string } | undefined;
    const raced = vi.fn(async () => {
      live = { paneId: 'wA:p15', cwd: repo };
      throw new Error('herdr từ chối yêu cầu (agent_name_taken).');
    });
    const late = await startProjectSession(request('claude', 'shared'), deps(createServices({ startAgent: raced, findAgent: () => live })));
    expect(late).toMatchObject({ ok: true, sessionId: 'wA:p15' });

    // The same name in another repo is not this session: never opened, and the refusal says so.
    const elsewhere = { paneId: 'wB:p3', cwd: path.join(root, 'other-repo') };
    const foreign = vi.fn(async () => { throw new Error('herdr từ chối yêu cầu (agent_name_taken).'); });
    await expect(startProjectSession(request('claude', 'shared'), deps(createServices({ startAgent: foreign, findAgent: () => elsewhere }))))
      .rejects.toThrow('thư mục khác');
    expect(foreign).toHaveBeenCalledTimes(1);

    const refused = vi.fn(async () => { throw new Error('herdr từ chối yêu cầu (agent_blocked).'); });
    await expect(startProjectSession(request('claude', 'shared'), deps(createServices({ startAgent: refused }))))
      .rejects.toThrow('agent_blocked');
  });

  it('refuses a shared checkout at the protected main repository root', async () => {
    const protectedPath = path.join(root, 'Duancanhan', 'Project_QuanLyGiaiDau', 'GiaiDau');
    const protectedTree = { nodes: [
      { id: 'folder', kind: 'folder', name: 'Project', path: path.dirname(protectedPath) },
      { id: 'repo', parentId: 'folder', kind: 'repository', name: 'GiaiDau', path: protectedPath },
    ] satisfies ProjectTreeNode[] };
    const services = createServices();
    await expect(startProjectSession(request('omp', 'shared'), {
      store: {} as ProjectStore,
      loadTree: async () => protectedTree,
      services,
    })).rejects.toThrow('Không thể dùng chung thư mục chính');
    expect(services.openChat).not.toHaveBeenCalled();
  });

  it('opens an omp chat right in a folder that holds no repo, and refuses what needs git there', async () => {
    const plain = { nodes: [{ id: 'folder', kind: 'folder', name: 'Notes', path: root }] satisfies ProjectTreeNode[] };
    const services = createServices();
    const plainDeps = { store: {} as ProjectStore, loadTree: async () => plain, services };
    await expect(startProjectSession(request('omp', 'shared', 'folder'), plainDeps)).resolves.toMatchObject({ ok: true, checkout: root });
    expect(services.openChat).toHaveBeenCalledWith(expect.objectContaining({ cwd: root }));
    await expect(startProjectSession(request('omp', 'separate', 'folder'), plainDeps)).rejects.toThrow('không tạo được worktree');
    await expect(startProjectSession(request('claude', 'shared', 'folder'), plainDeps)).rejects.toThrow('cần repo');
  });

  it.each(['codex', 'pi', 'thinkrail'] as const)('starts %s through its lane wrapper in a Herdr tab', async (engine) => {
    const coordinator = boardCoordinator();
    const herdr = {
      startAgent: vi.fn(async () => 'unexpected-native-agent'),
      startCli: vi.fn(async () => 'wA:p12'),
      snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage,
    };
    const runtime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async () => coordinator),
      boardFolders: () => [],
      herdr,
      runProcess: vi.fn(async () => ({
        ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false,
      })),
      effectiveSettings: async () => ({}),
    });

    const result = await startProjectSession(request(engine, 'shared'), deps(runtime));

    expect(result).toMatchObject({ ok: true, sessionId: 'wA:p12', checkout: repo });
    expect(herdr.startAgent).not.toHaveBeenCalled();
    expect(herdr.startCli).toHaveBeenCalledWith({
      cwd: repo,
      name: `${engine}-sua-loi-dang-nhap`,
      command: path.join(os.homedir(), '.local', 'bin', `${engine}.cmd`),
      prompt: 'Hãy sửa lỗi đăng nhập.',
    });
  });

  it('adapts the coordinator and herdr using their runtime contracts', async () => {
    const coordinator = boardCoordinator();
    const herdr = {
      startAgent: vi.fn(async () => 'wA:p9'),
      startCli: vi.fn(async () => 'wA:p10'),
      snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage,
    };
    const runtime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async () => coordinator),
      boardFolders: () => [],
      herdr,
      runProcess: vi.fn(async () => ({
        ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false,
      })),
      effectiveSettings: async () => ({}),
    });
    const omp = await startProjectSession(request('omp', 'shared'), deps(runtime));
    expect(omp.sessionId).toBe('board-session');
    expect(coordinator.openNewChat).toHaveBeenCalledWith({ cwd: repo, role: 'chat' });
    expect(coordinator.submitPrompt).toHaveBeenCalledWith(expect.objectContaining({
      targetSessionId: 'board-session',
      text: 'Hãy sửa lỗi đăng nhập.',
      mode: 'chat',
    }));

    const claude = await startProjectSession(request('claude', 'shared'), deps(runtime));
    expect(claude).toMatchObject({ sessionId: 'wA:p9', checkout: repo });
    expect(herdr.startAgent).toHaveBeenCalledWith({
      cwd: repo,
      kind: 'claude',
      name: 'claude-sua-loi-dang-nhap',
      // A Claude opened from the Project tree never asks for permission.
      args: ['--dangerously-skip-permissions'],
      prompt: 'Hãy sửa lỗi đăng nhập.',
    });
  });

  it('opens every engine with no first prompt: the user types into the session', async () => {
    const coordinator = boardCoordinator();
    const herdr = {
      startAgent: vi.fn(async () => 'wA:p9'),
      startCli: vi.fn(async () => 'wA:p10'),
      snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage,
    };
    const runtime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async () => coordinator),
      boardFolders: () => [],
      herdr,
      runProcess: vi.fn(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false })),
      effectiveSettings: async () => ({}),
    });
    const empty = (engine: ProjectSessionStartMessage['engine']) => ({ ...request(engine, 'shared'), initialPrompt: '  ' });
    await expect(startProjectSession(empty('omp'), deps(runtime))).resolves.toMatchObject({ ok: true, sessionId: 'board-session' });
    expect(coordinator.submitPrompt).not.toHaveBeenCalled();
    await expect(startProjectSession(empty('claude'), deps(runtime))).resolves.toMatchObject({ ok: true, sessionId: 'wA:p9' });
    await expect(startProjectSession(empty('agy'), deps(runtime))).resolves.toMatchObject({ ok: true, sessionId: 'wA:p9' });
    expect(herdr.startAgent).toHaveBeenCalledWith({ cwd: repo, kind: 'agy', name: 'agy-sua-loi-dang-nhap' });
  });

  it('reopens the board chat that ran an omp session, in the board folder holding it, and types the prompt', async () => {
    const stopped = boardCoordinator([{ id: 'board-1', status: 'crashed', runEpoch: 3 } as CompanySessionSummary]);
    const runtime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async () => stopped),
      boardFolders: () => [path.join(root, 'other'), root],
      herdr: { startAgent: vi.fn(async () => 'wA:p9'), startCli: vi.fn(async () => 'wA:p10'), snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage },
      runProcess: vi.fn(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false })),
      effectiveSettings: async () => ({}),
    });
    await expect(runtime.reopenBoardChat?.({ nativeSessionId: 'native-1', cwd: repo, prompt: 'làm tiếp' })).resolves.toEqual({ folder: root, sessionId: 'board-1' });
    // A crashed chat has no process to resume: it restarts on its own omp file.
    expect(stopped.controlSession).toHaveBeenCalledWith('board-1', 'restart', 3);
    expect(stopped.submitPrompt).toHaveBeenCalledWith(expect.objectContaining({ targetSessionId: 'board-1', text: 'làm tiếp', mode: 'chat' }));
    // An omp session no board chat ran, or one outside every board folder, has no chat to reopen.
    await expect(runtime.reopenBoardChat?.({ nativeSessionId: 'native-2', cwd: repo, prompt: '' })).resolves.toBeUndefined();
    await expect(runtime.reopenBoardChat?.({ nativeSessionId: 'native-1', cwd: os.tmpdir(), prompt: '' })).resolves.toBeUndefined();

    // A board chat still running is only pointed at, never resumed again.
    const live = boardCoordinator([{ id: 'board-1', status: 'idle', runEpoch: 4 } as CompanySessionSummary]);
    const liveRuntime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async () => live),
      boardFolders: () => [root],
      herdr: { startAgent: vi.fn(async () => 'wA:p9'), startCli: vi.fn(async () => 'wA:p10'), snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage },
      runProcess: vi.fn(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false })),
      effectiveSettings: async () => ({}),
    });
    await expect(liveRuntime.reopenBoardChat?.({ nativeSessionId: 'native-1', cwd: repo, prompt: '' })).resolves.toEqual({ folder: root, sessionId: 'board-1' });
    expect(live.controlSession).not.toHaveBeenCalled();
    expect(live.submitPrompt).not.toHaveBeenCalled();

    // Nested board folders: the first one holding the folder never ran it, the next one did.
    const inner = boardCoordinator();
    inner.sessionForNative.mockImplementation(() => null);
    const outer = boardCoordinator([{ id: 'board-1', status: 'parked', runEpoch: 5 } as CompanySessionSummary]);
    const nestedRuntime = createProjectSessionRuntime({
      coordinatorFor: vi.fn(async (folder: string) => (folder === repo ? inner : outer)),
      boardFolders: () => [repo, root],
      herdr: { startAgent: vi.fn(async () => 'wA:p9'), startCli: vi.fn(async () => 'wA:p10'), snapshot: () => ({ agents: [] }) as unknown as HerdrAgentsMessage },
      runProcess: vi.fn(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false })),
      effectiveSettings: async () => ({}),
    });
    await expect(nestedRuntime.reopenBoardChat?.({ nativeSessionId: 'native-1', cwd: repo, prompt: '' })).resolves.toEqual({ folder: root, sessionId: 'board-1' });
    expect(outer.controlSession).toHaveBeenCalledWith('board-1', 'resume', 5);
  });

  it('makes a separate worktree for Claude as for omp, and starts the agent in it', async () => {
    const services = createServices();
    const result = await startProjectSession(request('claude', 'separate'), deps(services));
    const worktree = path.join(root, 'repo.worktrees', 'sua-loi-dang-nhap');
    expect(result).toMatchObject({ sessionId: 'claude-pane', checkout: worktree });
    expect(services.startAgent).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktree }));
  });

  it('uses the prepare script for the OMP worktree before opening the chat', async () => {
    const services = createServices({
      effectiveSettings: vi.fn(async () => ({ worktreePrepare: { argv: ['npm', 'install'], timeoutMs: 1234 } })),
    });
    await startProjectSession(request('omp', 'separate'), deps(services));
    expect(services.runSetupScript).toHaveBeenCalledWith(['npm', 'install'], path.join(root, 'repo.worktrees', 'sua-loi-dang-nhap'), 1234);
    expect(services.openChat).toHaveBeenCalledWith(expect.objectContaining({ cwd: path.join(root, 'repo.worktrees', 'sua-loi-dang-nhap') }));
  });

  it('TC-STARTLOG-05 reports each stage it enters, in order, skipping the ones it does not run', async () => {
    const stages = async (services: ReturnType<typeof createServices>, worktree: 'separate' | 'shared') => {
      const seen: string[] = [];
      await startProjectSession(request('claude', worktree), deps(services), (stage) => seen.push(stage));
      return seen;
    };
    expect(await stages(createServices(), 'separate')).toEqual(['worktree', 'launch']);
    const withScript = createServices({
      effectiveSettings: vi.fn(async () => ({ worktreePrepare: { argv: ['npm', 'install'], timeoutMs: 1 } })),
    });
    expect(await stages(withScript, 'separate')).toEqual(['worktree', 'setup', 'launch']);
    expect(await stages(createServices(), 'shared')).toEqual(['launch']);
  });


  it('normalizes task names to safe path slugs', () => {
    expect(taskSlug('../../ A/B !!!')).toBe('a-b');
  });
});
