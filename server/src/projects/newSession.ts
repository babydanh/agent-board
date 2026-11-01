import * as path from 'node:path';

import { type BoardAgentEngine, type HerdrAgentEngine, isEngineForLaunch, type WrapperAgentEngine } from '../../../core/src/agentEngines.js';
import type {
  ProjectSessionProgressMessage,
  ProjectSessionStartMessage,
  ProjectSessionStartResultMessage,
  ProjectSettingsValues,
  ProjectTreeNode,
} from '../../../core/src/messages.js';
import { isInsideRepo } from '../company/workItems/workItemScheduler.js';
import { LibraryUserError } from '../library/libraryError.js';
import { createProjectSessionWorktree } from './projectSessionWorktree.js';
import type { ProjectTreeSnapshot } from './projectTree.js';
import type { ProjectModuleDeps } from './services.js';

export interface ProjectSessionServices {
  readonly effectiveSettings: (nodeId: string) => Promise<ProjectSettingsValues>;
  readonly runGit: (
    file: string,
    argv: readonly string[],
    cwd: string,
    timeoutMs: number,
  ) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  readonly openChat: (input: { readonly folder: string; readonly cwd: string; readonly prompt: string }) => Promise<string>;
  /** Opens an interactive agent in a new herdr tab in `cwd`, with its own command-line arguments; resolves with its pane id. */
  readonly startAgent: (input: {
    readonly cwd: string;
    readonly kind: BoardAgentEngine | HerdrAgentEngine;
    readonly name: string;
    readonly args?: readonly string[];
    readonly prompt: string;
  }) => Promise<string>;
  /** Opens a wrapped CLI in a Herdr shell tab, where cli_session.py supplies the lane guard. */
  readonly startCli: (input: {
    readonly cwd: string;
    readonly kind: WrapperAgentEngine;
    readonly name: string;
    readonly prompt: string;
  }) => Promise<string>;
  /** The live herdr agent under this name, if any: its pane id and working directory. */
  readonly findAgent: (name: string) => { readonly paneId: string; readonly cwd: string } | undefined;
  /**
   * Reopens the board chat that ran this omp session, in the board folder holding `cwd`, then types
   * the prompt into it; undefined when no board chat ran it. Unset where no board folders exist.
   */
  readonly reopenBoardChat?: (input: {
    readonly nativeSessionId: string;
    readonly cwd: string;
    readonly prompt: string;
  }) => Promise<{ readonly folder: string; readonly sessionId: string } | undefined>;
  readonly runSetupScript: (
    argv: readonly string[],
    cwd: string,
    timeoutMs: number,
  ) => Promise<{ readonly code: number; readonly stderr: string }>;
}


/** Start a session from a Project checkout using a separate worktree or shared directory. */
export async function startProjectSession(
  request: ProjectSessionStartMessage,
  deps: ProjectModuleDeps<ProjectSessionServices>,
  /** Told each stage as the start enters it; a stage this request does not run is never reported. */
  report: (stage: ProjectSessionProgressMessage['stage']) => void = () => undefined,
): Promise<ProjectSessionStartResultMessage> {
  if (request.taskName.trim() === '') throw new LibraryUserError('Hãy nhập tên việc.');
  // Every engine opens an interactive session the user types into; a first prompt is optional.
  const tree = await deps.loadTree();
  const node = tree.nodes.find((candidate) => candidate.id === request.nodeId);
  if (node === undefined) throw new LibraryUserError('Không tìm thấy thư mục hoặc repo đã chọn.');
  const folder = findFolder(node, tree);
  const folderPath = folder.path;
  if (folderPath === undefined) throw new LibraryUserError('Không tìm thấy đường dẫn thư mục Project.');
  const repos = tree.nodes.filter((candidate) => candidate.kind === 'repository' && candidate.parentId === folder.id);
  const repo = node.kind === 'repository' ? node : ancestor(node, tree, 'repository');
  const selectedRepo = repo ?? (repos.length === 1 ? repos[0] : undefined);
  if (selectedRepo === undefined && repos.length > 1) {
    throw new LibraryUserError('Thư mục có nhiều repo. Hãy chọn repo cần mở phiên.');
  }
  // A folder that is not a git repo still hosts a plain omp chat, run right in the folder.
  if (selectedRepo === undefined) {
    if (request.engine !== 'omp') throw new LibraryUserError('Thư mục này không phải repo git: các CLI ngoài omp cần repo. Hãy chọn OMP.');
    if (request.worktree !== 'shared') throw new LibraryUserError('Thư mục này không phải repo git nên không tạo được worktree. Hãy chọn "Dùng chung thư mục này".');
  }
  const repoPath = selectedRepo === undefined ? folderPath : selectedRepo.path;
  if (repoPath === undefined) throw new LibraryUserError('Đường dẫn repo không hợp lệ.');
  const sharedCheckout = node.kind === 'checkout' ? node.path : repoPath;
  if (request.worktree === 'shared' && sharedCheckout !== undefined && isProtectedMainRepo(sharedCheckout)) {
    throw new LibraryUserError('Không thể dùng chung thư mục chính của Project_QuanLyGiaiDau. Hãy tạo worktree riêng.');
  }
  // herdr names agents uniquely. A live agent under this name running where this request would run
  // (the same shared checkout, or a worktree beside this repo) is this same session asked twice: the
  // dialog reopened while the first start was still on its way. Open it; start no second one.
  const name = request.engine === 'omp' ? undefined : agentName(request.engine, request.taskName);
  const home = request.worktree === 'shared' ? sharedCheckout : `${repoPath}.worktrees`;
  const sameSession = (agent: { readonly paneId: string; readonly cwd: string } | undefined) =>
    agent !== undefined && home !== undefined && isInsideRepo(agent.cwd, home)
    && (request.worktree !== 'shared' || isInsideRepo(home, agent.cwd))
      ? agent
      : undefined;
  const running = name === undefined ? undefined : sameSession(deps.services.findAgent(name));
  if (running !== undefined) return opened(request, running.paneId, running.cwd);
  if (request.worktree === 'separate') report('worktree');
  const checkout = request.worktree === 'shared'
    ? sharedCheckout
    : (await createProjectSessionWorktree({
      repo: repoPath,
      taskName: request.taskName,
      run: deps.services.runGit,
    })).path;
  if (checkout === undefined) throw new LibraryUserError('Đường dẫn checkout không hợp lệ.');
  if (request.worktree === 'separate') {
    const settings = await deps.services.effectiveSettings(folder.id);
    const script = settings.worktreePrepare;
    if (script !== undefined) {
      report('setup');
      const result = await deps.services.runSetupScript(script.argv, checkout, script.timeoutMs);
      if (result.code !== 0) {
        throw new LibraryUserError(`Script chuẩn bị worktree thất bại: ${result.stderr.trim() || `mã ${result.code}`}`);
      }
    }
  }

  report('launch');
  let sessionId: string;
  try {
    if (request.engine === 'omp') {
      sessionId = await deps.services.openChat({ folder: folderPath, cwd: checkout, prompt: request.initialPrompt });
    } else if (isEngineForLaunch(request.engine, 'wrapper')) {
      sessionId = await deps.services.startCli({
        cwd: checkout,
        kind: request.engine,
        name: name ?? agentName(request.engine, request.taskName),
        prompt: request.initialPrompt,
      });
    } else if (isEngineForLaunch(request.engine, 'herdr')) {
      sessionId = await deps.services.startAgent({
        cwd: checkout,
        kind: request.engine,
        name: name ?? agentName(request.engine, request.taskName),
        prompt: request.initialPrompt,
      });
    } else {
      throw new LibraryUserError('Không hỗ trợ CLI đã chọn.');
    }
  } catch (error) {
    const taken = name !== undefined && error instanceof Error && error.message.includes('agent_name_taken');
    // Two starts of one session raced past the check above: the other one won, open it.
    const winner = taken ? sameSession(deps.services.findAgent(name)) : undefined;
    if (winner !== undefined) return opened(request, winner.paneId, winner.cwd);
    if (taken) throw new LibraryUserError(`Tên phiên ${name} đang được một agent ở thư mục khác dùng. Hãy đặt "Tên việc" khác trong Tuỳ chọn thêm.`);
    throw new LibraryUserError(error instanceof Error ? error.message : 'Không mở được phiên mới.');
  }
  return opened(request, sessionId, checkout);
}

function opened(request: ProjectSessionStartMessage, sessionId: string, checkout: string): ProjectSessionStartResultMessage {
  return { type: 'projectSessionStartResult', requestId: request.requestId, ok: true, sessionId, checkout };
}

/** A herdr agent name for the session: the engine and the task's first words, as herdr allows. */
function agentName(engine: HerdrAgentEngine | WrapperAgentEngine, taskName: string): string {
  const slug = taskName.normalize('NFKD').replace(/[đĐ]/g, 'd').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${engine}-${slug}`.slice(0, 32).replace(/-+$/g, '');
}

function findFolder(node: ProjectTreeNode, tree: ProjectTreeSnapshot): ProjectTreeNode {
  if (node.kind === 'folder') {
    if (node.path === undefined) throw new LibraryUserError('Không tìm thấy đường dẫn thư mục Project.');
    return node;
  }
  const found = ancestor(node, tree, 'folder');
  if (found === undefined || found.path === undefined) throw new LibraryUserError('Không tìm thấy thư mục Project.');
  return found;
}

function ancestor(node: ProjectTreeNode, tree: ProjectTreeSnapshot, kind: ProjectTreeNode['kind']): ProjectTreeNode | undefined {
  let current = node;
  while (current.kind !== kind && current.parentId !== undefined) {
    const parent = tree.nodes.find((candidate) => candidate.id === current.parentId);
    if (parent === undefined) return undefined;
    current = parent;
  }
  return current.kind === kind ? current : undefined;
}

function isProtectedMainRepo(checkout: string): boolean {
  const normalized = path.resolve(checkout).replaceAll('\\', '/').toLocaleLowerCase('en-US');
  return /\/duancanhan\/project_quanlygiai[dđ]au\/[^/]+$/.test(normalized) &&
    !normalized.includes('/.worktrees/');
}

