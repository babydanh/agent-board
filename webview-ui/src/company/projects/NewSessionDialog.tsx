import './NewSessionDialog.css';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { AGENT_ENGINES, type ProjectSessionEngine } from '../../../../core/src/agentEngines.js';
import type { ProjectTreeNode } from '../../../../core/src/messages.js';
import { PetLoader } from '../components/PetLoader.js';
import { StartLog } from '../components/StartLog.js';
import { sessionRequestSteps } from '../herdrView.js';
import { foldersUnder } from './projectNodeTargets.js';
import { type ProjectStore, useProjectState } from './projectStore.js';

export interface NewSessionDialogProps {
  store: ProjectStore;
  nodeId: string;
  onClose: () => void;
  initialEngine?: SessionEngine;
  /** Called once the session is open, with the Project folder it runs in; the board takes the user to it. */
  onStarted?: (session: { readonly sessionId: string; readonly engine: SessionEngine; readonly folderPath: string | undefined }) => void;
}

type SessionEngine = ProjectSessionEngine;

export function NewSessionDialog({ store, nodeId, onClose, initialEngine, onStarted }: NewSessionDialogProps) {
  const state = useProjectState(store);
  const requested = state.nodes.find((node) => node.id === nodeId);
  // Opened on a Project or group: pick which of its folders the session runs in.
  const folderChoices = useMemo(
    () => (requested?.kind === 'project' || requested?.kind === 'group' ? foldersUnder(state.nodes, requested) : []),
    [requested, state.nodes],
  );
  const [folderId, setFolderId] = useState('');
  useEffect(() => {
    if (folderChoices.length === 1) setFolderId(folderChoices[0]?.id ?? '');
  }, [folderChoices]);
  const target = folderChoices.length > 0 ? folderChoices.find((folder) => folder.id === folderId) : requested;
  const candidateRepos = useMemo(() => getCandidateRepos(target, state.nodes), [target, state.nodes]);
  const [repoId, setRepoId] = useState(candidateRepos.length === 1 ? candidateRepos[0]?.id ?? '' : '');
  // The engine the menu asked for opens as soon as the folder's repos are known; Enter opens it too.
  const chosenEngine: SessionEngine = initialEngine ?? 'omp';
  const [worktree, setWorktree] = useState<'separate' | 'shared'>('separate');
  const [taskName, setTaskName] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [started, setStartedEngine] = useState<SessionEngine>('omp');

  useEffect(() => {
    if (candidateRepos.length === 1) setRepoId(candidateRepos[0]?.id ?? '');
    else if (!candidateRepos.some((repo) => repo.id === repoId)) setRepoId('');
  }, [candidateRepos, repoId]);

  // Repos arrive with the full tree; the quick one lists folders only.
  // A saved tree from an earlier visit is not proof: its repos may have changed since.
  const reposKnown = state.treeComplete && !state.treeStale;
  const plainFolder = target?.kind === 'folder' && reposKnown && candidateRepos.length === 0;
  const workdir = plainFolder ? 'shared' : worktree;
  const selectedRepo = candidateRepos.find((repo) => repo.id === repoId);
  const shownTaskName = taskName.trim() || autoTaskName(chosenEngine, initialPrompt);
  const worktreePath = selectedRepo?.path === undefined ? '' : `${selectedRepo.path}.worktrees/${taskSlug(shownTaskName)}`;
  const result = requestId === null ? undefined : state.results[requestId];
  const pending = requestId !== null && state.pending[requestId] !== undefined;
  const reason = result?.type === 'projectSessionStartResult' && !result.ok
    ? result.reason
    : requestId === null ? undefined : state.errors.sessionStart;
  const opened = result?.type === 'projectSessionStartResult' && result.ok ? result : undefined;
  // The Project folder the session runs in: the board opens it there.
  let folderNode = target;
  while (folderNode !== undefined && folderNode.kind !== 'folder') {
    const parentId = folderNode.parentId;
    folderNode = parentId === undefined ? undefined : state.nodes.find((node) => node.id === parentId);
  }
  const folderPath = folderNode?.path;
  useEffect(() => {
    if (opened?.sessionId !== undefined) onStarted?.({ sessionId: opened.sessionId, engine: started, folderPath });
  }, [opened, onStarted, started, folderPath]);
  // A start sent from an earlier opening of this dialog is still on its way: a second one would ask
  // for the same session again. The store keeps pending requests across dialog openings.
  const earlierStart = !pending && Object.values(state.pending).some((sent) => sent.type === 'projectSessionStart');
  const blocked = pending || earlierStart || target === undefined || (selectedRepo === undefined && !plainFolder);

  function start(choice: SessionEngine) {
    if (blocked || target === undefined) return;
    const text = initialPrompt.trim();
    setStartedEngine(choice);
    setRequestId(store.startSession({
      nodeId: target.kind === 'checkout' || selectedRepo === undefined ? target.id : selectedRepo.id,
      engine: choice,
      worktree: workdir,
      taskName: taskName.trim() || autoTaskName(choice, text),
      initialPrompt: text,
    }));
  }

  // A selected CLI from the menu opens as soon as the folder's repos are known, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialEngine === undefined || autoStarted.current || blocked) return;
    if (initialEngine !== 'omp' && plainFolder) return;
    autoStarted.current = true;
    start(initialEngine);
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start(chosenEngine);
  }

  return (
    <div className="project-session-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="project-session-dialog" role="dialog" aria-modal="true" aria-labelledby="project-session-title" onSubmit={submit}>
        <header className="project-session-dialog__header">
          <h2 id="project-session-title">Phiên mới{folderNode?.name === undefined ? '' : ` · ${folderNode.name}`}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        {folderChoices.length > 1 && (
          <label>
            Thư mục
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)} required>
              <option value="">Chọn thư mục</option>
              {folderChoices.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
        )}
        {candidateRepos.length > 1 && (
          <label>
            Repo
            <select value={repoId} onChange={(event) => setRepoId(event.target.value)} required>
              <option value="">Chọn repo</option>
              {candidateRepos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            </select>
          </label>
        )}
        {!reposKnown && target?.kind === 'folder' && <p className="project-session-dialog__path">Đang đọc các repo trong thư mục…</p>}
        <div className="project-session-dialog__engines" role="group" aria-label="Chọn công cụ">
          {ENGINES.map((choice) => {
            const needsRepo = choice.id !== 'omp' && plainFolder;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={chosenEngine === choice.id}
                disabled={blocked || needsRepo}
                title={needsRepo ? 'Thư mục này không phải repo git: CLI bên herdr cần repo.' : choice.hint}
                onClick={() => start(choice.id)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <details>
          <summary>Tuỳ chọn thêm</summary>
          <div className="project-session-dialog__more">
            {!plainFolder && (
              <fieldset>
                <legend>Thư mục làm việc</legend>
                <label><input type="radio" name="project-session-worktree" checked={worktree === 'separate'} onChange={() => setWorktree('separate')} /> Worktree riêng (mặc định)</label>
                <label><input type="radio" name="project-session-worktree" checked={worktree === 'shared'} onChange={() => setWorktree('shared')} /> Dùng chung thư mục này</label>
              </fieldset>
            )}
            <label>
              Tên việc
              <input value={taskName} placeholder={shownTaskName} onChange={(event) => setTaskName(event.target.value)} maxLength={120} />
            </label>
            {workdir === 'separate' && <p className="project-session-dialog__path">Worktree sẽ tạo: <code>{worktreePath}</code></p>}
            <label>
              Prompt đầu (không bắt buộc)
              <textarea value={initialPrompt} onChange={(event) => setInitialPrompt(event.target.value)} rows={3} />
            </label>
          </div>
        </details>
        {plainFolder && <p className="project-session-dialog__path">Thư mục này không phải repo git: phiên omp chạy ngay trong <code>{target?.path}</code>.</p>}
        {reason && <p role="alert" className="project-session-dialog__error">{reason}</p>}
        {pending && (
          <>
            <PetLoader text="Đang mở phiên…" />
            <StartLog steps={sessionRequestSteps(workdir === 'separate' ? worktreePath : null, requestId === null ? [] : state.progress[requestId] ?? [])} bones={false} />
          </>
        )}
        {earlierStart && <p role="status">Phiên bấm mở lúc trước vẫn đang khởi động, chờ nó xong rồi hãy mở phiên khác.</p>}
        {opened !== undefined && <p role="status">Đã mở phiên tại <code>{opened.checkout}</code></p>}
      </form>
    </div>
  );
}

// Opened from the board: omp, Claude Code and agy only. Other CLIs still show up in the session list.
const ENGINES: readonly { readonly id: SessionEngine; readonly label: string; readonly hint: string }[] = AGENT_ENGINES.filter(
  ({ launch }) => launch !== 'wrapper',
).map(({ id, label, icon, launch }) => ({
  id,
  label: `${icon} ${label}`,
  hint:
    launch === 'board'
      ? 'Mở phiên omp ngay, gõ việc trong terminal'
      : `Mở ${label} ngay trong một tab herdr, gõ việc trong đó`,
}));

/** Names the worktree when the user gives no name: the task's first words, else the tool and the time. */
function autoTaskName(engine: SessionEngine, text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim().slice(0, 60) ?? '';
  if (firstLine !== '') return firstLine;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${engine}-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function getCandidateRepos(target: ProjectTreeNode | undefined, nodes: readonly ProjectTreeNode[]): ProjectTreeNode[] {
  if (target === undefined) return [];
  if (target.kind === 'repository') return [target];
  if (target.kind === 'checkout') {
    const repo = nodes.find((node) => node.id === target.parentId && node.kind === 'repository');
    return repo === undefined ? [] : [repo];
  }
  if (target.kind !== 'folder') return [];
  return nodes.filter((node) => node.kind === 'repository' && node.parentId === target.id);
}

function taskSlug(name: string): string {
  const slug = name.normalize('NFKD').replace(/[đĐ]/g, 'd').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return slug || 'viec-moi';
}
