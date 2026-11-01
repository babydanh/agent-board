import { useEffect, useMemo, useState } from 'react';

import type { FleetBranchActionMessage, FleetBranchAnalysis, FleetLocalBranchSnapshot, FleetMachineSnapshot, FleetPullRequest, FleetTaskCreateMessage } from '../../../../core/src/messages.js';
import { BusyNote } from '../components/BusyNote.js';
import { openPendingTab } from './cloudLavish.js';
import { MAX_SESSIONS_PER_MACHINE, pickMachine, projectMachines, randomSuffix, slugFromPrompt } from './cloudTaskPick.js';
import { CloudTerminal } from './CloudTerminal.js';
import { FLEET_ACTION_LABEL } from './fleetActionLabel.js';
import { fleetStore } from './fleetClient.js';
import { createFleetDiffCommentSelector, type FleetDiffCommentSelection } from './fleetDiffComment.js';
import { type FleetState, useFleetState } from './fleetStore.js';

type TaskEngine = NonNullable<FleetTaskCreateMessage['engine']>;
/** "Phiên mới · Claude/omp cloud" from a right-click menu: which agent the request box should start with. */
export interface CloudRequest {
  readonly engine: TaskEngine;
  readonly token: number;
  /** The Project-tree node that was right-clicked: the sidebar opens the box and the session under it. */
  readonly nodeId?: string;
}

export function FleetView({ request = null }: { request?: CloudRequest | null }) {
  const fleet = useFleetState(fleetStore);
  const localBranches = fleet.snapshot?.localBranches ?? [];
  const branchAnalyses = fleet.snapshot?.branchAnalyses ?? [];

  return (
    <div className="company-shell-page flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-text">Cloud</h1>
          <p className="text-xs text-text-muted">Máy InstaBox được báo cáo cho hub fleet.</p>
        </div>
        <button
          type="button"
          onClick={() => fleetStore.requestFleet()}
          className="company-btn company-btn-md company-btn-ghost touch-target shrink-0"
        >
          Làm mới
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {fleet.terminal !== null && (
          <CloudTerminal
            key={fleet.terminal.terminalId}
            terminalId={fleet.terminal.terminalId}
            label={`${fleet.terminal.machine} · ${fleet.terminal.session}`}
            onClose={() => fleetStore.closeTerminal()}
            onReopen={fleetStore.reopenTerminal}
          />
        )}
        <ActionStatus fleet={fleet} />
        {fleet.snapshot?.branchAnalysisPending && (
          <p role="status" className="text-xs text-text-muted">Đang phân tích nhánh trong nền…</p>
        )}
        {localBranches.length > 0 && (
          <section aria-labelledby="fleet-local-branches-title" className="space-y-2">
            <h2 id="fleet-local-branches-title" className="text-sm font-semibold text-text">Nhánh cục bộ</h2>
            <ul className="space-y-2">
              {localBranches.map((branch) => {
                const analysis = branchAnalyses.find(
                  (candidate) => candidate.checkout === branch.checkout && candidate.branch === branch.branch,
                );
                return (
                  <LocalBranchRow
                    key={`${branch.checkout}\0${branch.branch}`}
                    branch={branch}
                    analysis={analysis}
                    busy={fleet.action !== null}
                  />
                );
              })}
            </ul>
          </section>
        )}
        {fleet.diff !== null && (
          <DiffPanel
            key={`${fleet.diff.machine}\0${fleet.diff.path}`}
            diff={fleet.diff}
            snapshot={fleet.snapshot}
            busy={fleet.action !== null}
          />
        )}
        {fleet.snapshot !== null && fleet.snapshot.machines.length > 0 && (
          <TaskForm machines={fleet.snapshot.machines} busy={fleet.action !== null} request={request} />
        )}
        {fleet.snapshot?.hubError && (
          <p
            role="alert"
            className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            Hub không khả dụng: {fleet.snapshot.hubError}
          </p>
        )}
        {fleet.error !== null && (
          <p role="alert" className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {fleet.error}
          </p>
        )}
        {fleet.snapshot === null && fleet.latestRequestId !== null && (
          <p role="status" className="text-sm text-text-muted">Đang tải danh sách máy Cloud…</p>
        )}
        {fleet.snapshot?.machines.length === 0 &&
          fleet.error === null &&
          fleet.snapshot?.hubError === undefined && (
            <p className="text-sm text-text-muted">Hub chưa báo cáo máy nào.</p>
          )}
        {fleet.snapshot !== null && fleet.snapshot.machines.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {fleet.snapshot.machines.map((machine) => (
              <MachineCard
                key={machine.agentId}
                machine={machine}
                analyses={branchAnalyses}
                busy={fleet.action !== null}
              />
            ))}
          </div>
        )}
        {fleet.snapshot !== null && (
          <section aria-labelledby="fleet-overlaps-title" className="space-y-2">
            <h2 id="fleet-overlaps-title" className="text-sm font-semibold text-text">Cảnh báo trùng tệp</h2>
            {fleet.snapshot.overlaps.length === 0 ? (
              <p className="text-sm text-text-muted">Chưa phát hiện tệp trùng lặp.</p>
            ) : (
              <ul className="space-y-2">
                {fleet.snapshot.overlaps.map((overlap) => (
                  <li
                    key={`${overlap.repo}\u0000${overlap.path}`}
                    className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
                  >
                    <p className="break-all font-mono text-text">{overlap.repo}/{overlap.path}</p>
                    <p className="mt-1 text-xs text-warning">
                      {overlap.level === 'line' ? 'Trùng dòng' : 'Trùng tệp'} · Máy: {overlap.machines.join(', ')}
                      {overlap.local ? ' · có phiên cục bộ' : ''}
                    </p>
                    {overlap.detail ? <p className="mt-1 break-all font-mono text-xs text-text-muted">{overlap.detail}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function LocalBranchRow({
  branch,
  analysis,
  busy,
}: {
  branch: FleetLocalBranchSnapshot;
  analysis?: FleetBranchAnalysis;
  busy: boolean;
}) {
  const pullRequest = branch.pullRequest;
  const sessionId = branch.sessionIds[0];
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-well px-3 py-2 text-xs">
      <span className="font-medium text-text">{branch.repo}</span>
      <span className="break-all font-mono">{branch.branch}</span>
      <span className="break-all text-text-muted">{branch.checkout}</span>
      <BranchStatusBadges {...branch} />
      <BranchActions branch={branch} busy={busy} />
      {pullRequest?.ci === 'red' && sessionId !== undefined && (
        <button
          type="button"
          disabled={busy}
          className="company-btn company-btn-sm company-btn-ghost ml-auto"
          onClick={() => fleetStore.sendLocalCiFailureComment(branch.checkout, sessionId, pullRequest)}
        >
          Gửi lỗi CI cho agent
        </button>
      )}
      {analysis !== undefined ? <BranchAnalysisDetails analysis={analysis} /> : null}
    </li>
  );
}

function BranchActions({ branch, busy }: { branch: FleetLocalBranchSnapshot; busy: boolean }) {
  if (branch.branch.toLowerCase() === 'main' || branch.branch.toLowerCase() === 'staging') return null;
  const run = (action: FleetBranchActionMessage['action']) => {
    if (action === 'push' && !window.confirm(`Đẩy nhánh ${branch.branch} lên origin?`)) return;
    if (action === 'delete-remote' && !window.confirm(`Xóa nhánh ${branch.branch} trên origin?`)) return;
    fleetStore.runBranchAction({ action, checkout: branch.checkout, branch: branch.branch });
  };
  const pullRequest = branch.pullRequest;
  const closed = pullRequest?.state === 'merged' || pullRequest?.state === 'closed';

  return (
    <details className="relative">
      <summary aria-label={`Thao tác PR cho ${branch.branch}`} className="company-btn company-btn-sm company-btn-ghost cursor-pointer">
        PR
      </summary>
      <div role="group" aria-label={`Thao tác nhánh ${branch.branch}`} className="absolute right-0 z-20 mt-1 flex min-w-48 flex-col rounded border border-hairline bg-panel p-1 shadow-xl">
        <button type="button" disabled={busy} onClick={() => run('push')} className="rounded px-2 py-1.5 text-left hover:bg-well disabled:opacity-50">
          Đẩy nhánh
        </button>
        {pullRequest === undefined && (
          <button type="button" disabled={busy} onClick={() => run('create-draft')} className="rounded px-2 py-1.5 text-left hover:bg-well disabled:opacity-50">
            Mở PR nháp
          </button>
        )}
        {pullRequest?.state === 'open' && pullRequest.isDraft && (
          <button type="button" disabled={busy} onClick={() => run('ready')} className="rounded px-2 py-1.5 text-left hover:bg-well disabled:opacity-50">
            Sẵn sàng
          </button>
        )}
        {closed && (
          <button type="button" disabled={busy} onClick={() => run('delete-remote')} className="rounded px-2 py-1.5 text-left text-warning hover:bg-well disabled:opacity-50">
            Xóa nhánh remote
          </button>
        )}
        <span className="px-2 py-1.5 text-text-muted">Gộp qua merge-lane</span>
      </div>
    </details>
  );
}
function BranchAnalysisDetails({ analysis }: { analysis: FleetBranchAnalysis }) {
  return (
    <div className="basis-full space-y-1 rounded bg-panel/60 px-2 py-1.5 text-xs text-text-muted">
      <p>
        So với origin/main: {analysis.changedFileCount} tệp
        {analysis.modules.length > 0
          ? ` · module chính: ${analysis.modules.map((module) => `${module.name} (${module.count})`).join(', ')}`
          : ''}
      </p>
      {analysis.changedFiles.length > 0 ? (
        <p className="break-all font-mono">Tệp: {analysis.changedFiles.slice(0, 5).join(', ')}</p>
      ) : null}
      {analysis.overlaps.length === 0 ? (
        <p>Không có nhánh khác đang chạm cùng tệp.</p>
      ) : (
        <ul className="space-y-0.5">
          {analysis.overlaps.map((overlap) => (
            <li key={overlap.branch}>
              Trùng với {overlap.branch}: {overlap.files.join(', ')} ·{' '}
              {overlap.mergeClean === false
                ? 'xung đột thật (merge-tree)'
                : overlap.mergeClean === true
                  ? 'merge-tree sạch'
                  : 'chưa xác minh được (thay đổi chưa commit hoặc thiếu ref)'}
            </li>
          ))}
        </ul>
      )}
      <p className="font-medium text-text">Đề xuất: {analysis.suggestion}</p>
    </div>
  );
}


function ActionStatus({ fleet }: { fleet: FleetState }) {
  if (fleet.action !== null) {
    const { kind, machine, session, startedAt } = fleet.action;
    const what = FLEET_ACTION_LABEL[kind];
    return (
      <BusyNote
        text={kind === 'branch' ? `${what} ${session}…` : `${what} trên ${machine} (${session})… máy đang ngủ thì mất 1–2 phút.`}
        since={startedAt}
        onCancel={fleetStore.cancelAction}
      />
    );
  }
  if (fleet.actionError !== null) {
    return (
      <p role="alert" className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
        {fleet.actionError}
      </p>
    );
  }
  if (fleet.createdTask !== null) {
    const { machine, session } = fleet.createdTask;
    return (
      <p className="flex flex-wrap items-center gap-2 rounded border border-hairline px-3 py-2 text-sm">
        Đã giao việc: Claude đang chạy trong phiên <span className="font-mono">{session}</span> trên {machine}.
        <button type="button" className="company-btn company-btn-sm company-btn-ghost" onClick={() => fleetStore.openTerminal(machine, session)}>
          Mở terminal
        </button>
      </p>
    );
  }
  return null;
}

const AUTO = '';

const TASK_REPOS = [
  { value: 'all', label: 'Cả 3 repo (một agent làm trọn tính năng)' },
  { value: 'backend', label: 'Chỉ Backend' },
  { value: 'web', label: 'Chỉ Web' },
  { value: 'app', label: 'Chỉ App' },
] as const;

/**
 * "Tạo Claude cloud": type the request, press the button. By default the board picks the least busy project
 * machine (below 3 agents), all three repositories, and a task name made from the request; "Tùy chọn" overrides.
 */
function TaskForm({ machines, busy, request }: { machines: readonly FleetMachineSnapshot[]; busy: boolean; request: CloudRequest | null }) {
  const [engine, setEngine] = useState<TaskEngine>('claude');
  // A new right-click request chooses the agent again, even when the same one was chosen before.
  useEffect(() => {
    if (request !== null) setEngine(request.engine);
  }, [request]);
  const agentName = engine === 'omp' ? 'omp' : 'Claude';
  const [machine, setMachine] = useState(AUTO);
  const [repo, setRepo] = useState<(typeof TASK_REPOS)[number]['value']>('all');
  const [slug, setSlug] = useState('');
  const [prompt, setPrompt] = useState('');
  const candidates = projectMachines(machines, repo);
  const target = machine === AUTO ? pickMachine(machines, repo) : machine;
  const slugOk = slug === '' || /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug);
  const ready = !busy && target !== null && slugOk && prompt.trim() !== '';
  const load = candidates.find((pick) => pick.machine === target);

  return (
    <form
      id="tao-claude-cloud"
      className="space-y-2 rounded border border-hairline bg-well p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || target === null) return;
        fleetStore.createTask({ machine: target, repo, slug: slug || slugFromPrompt(prompt, randomSuffix()), prompt, engine });
        setPrompt('');
        setSlug('');
      }}
    >
      <label className="block text-sm font-semibold text-text">
        Tạo {agentName} cloud
        <textarea
          className="mt-1 w-full rounded border border-hairline bg-transparent p-2 text-sm font-normal"
          rows={3}
          maxLength={20000}
          placeholder="Gõ việc cần làm, ví dụ: Sửa lỗi xếp sân đôi khi đổi giờ thi đấu"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-muted">
          {target === null
            ? candidates.length === 0
              ? `Chưa có máy nào ${repo === 'all' ? 'đủ 3 repo đồ án' : 'có repo này'}.`
              : `Cả ${candidates.length} máy đều đã chạy đủ ${MAX_SESSIONS_PER_MACHINE} việc. Đợi một việc xong hoặc chọn máy trong Tùy chọn.`
            : `Sẽ chạy trên ${target}${load ? ` (đang có ${load.sessions}/${MAX_SESSIONS_PER_MACHINE} việc)` : ''} · ${TASK_REPOS.find((item) => item.value === repo)?.label ?? repo}`}
        </p>
        <button type="submit" disabled={!ready} className="company-btn company-btn-md company-btn-primary">
          Tạo {agentName} cloud
        </button>
      </div>
      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer">Tùy chọn (agent, máy, repo, tên việc)</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <label>
            Agent
            <select
              className="mt-1 w-full rounded border border-hairline bg-transparent p-1 text-sm"
              value={engine}
              onChange={(event) => setEngine(event.target.value === 'omp' ? 'omp' : 'claude')}
            >
              <option value="claude">Claude</option>
              <option value="omp">omp</option>
            </select>
          </label>
          <label>
            Máy
            <select className="mt-1 w-full rounded border border-hairline bg-transparent p-1 text-sm" value={machine} onChange={(event) => setMachine(event.target.value)}>
              <option value={AUTO}>Tự chọn máy rảnh nhất</option>
              {candidates.map((pick) => (
                <option key={pick.machine} value={pick.machine}>
                  {pick.machine} ({pick.sessions}/{MAX_SESSIONS_PER_MACHINE} việc)
                </option>
              ))}
            </select>
          </label>
          <label>
            Repo
            <select
              className="mt-1 w-full rounded border border-hairline bg-transparent p-1 text-sm"
              value={repo}
              onChange={(event) => setRepo(TASK_REPOS.find((item) => item.value === event.target.value)?.value ?? 'all')}
            >
              {TASK_REPOS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            Tên việc (để trống: tự đặt từ nội dung)
            <input
              className="mt-1 w-full rounded border border-hairline bg-transparent p-1 font-mono text-sm"
              value={slug}
              maxLength={40}
              placeholder="sua-xep-san-ab12"
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </label>
        </div>
      </details>
    </form>
  );
}

function formatIdle(seconds: number): string {
  if (seconds < 60) return 'vừa hoạt động';
  if (seconds < 3600) return `rảnh ${Math.floor(seconds / 60)} phút`;
  return `rảnh ${Math.floor(seconds / 3600)} giờ`;
}

const FLEET_PR_STATE_LABEL: Record<FleetPullRequest['state'], string> = {
  open: 'Mở',
  merged: 'Đã gộp',
  closed: 'Đóng',
};

const FLEET_CI_LABEL: Record<FleetPullRequest['ci'], string> = {
  green: 'CI xanh',
  red: 'CI đỏ',
  running: 'CI đang chạy',
  none: '',
};


function BranchStatusBadges({
  branch,
  ahead,
  behind,
  pullRequest,
}: Pick<FleetLocalBranchSnapshot, 'branch' | 'ahead' | 'behind' | 'pullRequest'>) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-panel px-1.5 py-0.5 text-text-muted" title="Số commit hơn/kém origin">
        origin +{ahead} / −{behind}
      </span>
      {pullRequest && (
        <a
          className="rounded-full border border-hairline px-1.5 py-0.5 text-text hover:text-accent"
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          title={`${branch} · ${pullRequest.url}`}
        >
          PR #{pullRequest.number} · {pullRequest.isDraft ? 'Nháp' : FLEET_PR_STATE_LABEL[pullRequest.state]}
          {pullRequest.ci === 'none' ? null : ` · ${FLEET_CI_LABEL[pullRequest.ci]}`}
        </a>
      )}
    </span>
  );
}

function MachineCard({
  machine,
  analyses,
  busy,
}: {
  machine: FleetMachineSnapshot;
  analyses: readonly FleetBranchAnalysis[];
  busy: boolean;
}) {
  const lastSeen = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(machine.receivedAt);
  const stateLabel = machine.state === 'stale' ? 'Ngủ / mất kết nối' : 'Đang hoạt động';

  return (
    <article className="space-y-3 rounded border border-hairline bg-well p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="break-all font-mono text-sm font-semibold text-text">{machine.agentId}</h2>
        <span className={`text-xs ${machine.state === 'stale' ? 'text-warning' : 'text-text-muted'}`}>
          {stateLabel}
        </span>
      </div>
      <p className="text-xs text-text-muted">
        Lần cuối thấy: {lastSeen}
        {machine.diskFreeGb !== undefined && (
          <span className={machine.diskFreeGb < 3 ? 'text-warning' : ''}> · đĩa trống {machine.diskFreeGb} GB</span>
        )}
        {machine.skillStale === true && (
          <span className="text-warning" title="Skill, luật hoặc plugin trên máy này chưa theo bản đồng bộ mới nhất"> · bản cũ, cần đồng bộ</span>
        )}
      </p>
      <p className="text-sm text-text-secondary">
        {machine.sessionCount} phiên · {machine.engines.length > 0 ? machine.engines.join(', ') : 'không có engine'}
      </p>
      {(machine.tmuxSessions ?? []).length > 0 && (
        <ul className="space-y-1 border-t border-hairline pt-2">
          {(machine.tmuxSessions ?? []).map((session) => (
            <li key={session.name} className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
              <span className="font-mono font-medium text-text">{session.name}</span>
              {session.command ? <span>{session.command}</span> : null}
              {session.branch ? <span className="break-all font-mono">{session.branch}</span> : null}
              <span className="text-text-muted">{formatIdle(session.idleSeconds)}{session.attached ? ' · có người đang xem' : ''}</span>
              <button
                type="button"
                disabled={busy}
                className="company-btn company-btn-sm company-btn-ghost ml-auto"
                onClick={() => fleetStore.openTerminal(machine.agentId, session.name)}
              >
                Mở terminal
              </button>
            </li>
          ))}
        </ul>
      )}
      {(machine.lavishSessions ?? []).length > 0 && (
        <ul className="space-y-1 border-t border-hairline pt-2">
          {(machine.lavishSessions ?? []).map((session) => (
            <li key={session.key} className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
              <span className="font-medium text-text">Lavish</span>
              <span className="break-all font-mono">{shortPath(session.file)}</span>
              <button
                type="button"
                disabled={busy}
                className="company-btn company-btn-sm company-btn-ghost ml-auto"
                onClick={() => fleetStore.openLavish(machine.agentId, session.key, openPendingTab())}
              >
                Mở Lavish
              </button>
            </li>
          ))}
        </ul>
      )}
      {machine.repos.length > 0 ? (
        <ul className="space-y-1 border-t border-hairline pt-2">
          {machine.repos.map((repo, index) => {
            const path = repo.path;
            const pullRequest = repo.pullRequest;
            const analysis = analyses.find(
              (candidate) =>
                candidate.machine === machine.agentId &&
                candidate.path === path &&
                candidate.branch === repo.branch,
            );
            const ciSession = path === undefined
              ? undefined
              : (machine.tmuxSessions ?? []).find(
                  (session) =>
                    session.branch === repo.branch &&
                    typeof session.cwd === 'string' &&
                    (session.cwd === path || session.cwd.startsWith(`${path}/`)),
                );
            return (
              <li key={`${repo.name}-${repo.branch}-${index}`} className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
                <span className="font-medium text-text">{repo.name}</span>
                <span className="break-all font-mono">{repo.branch}</span>
                <BranchStatusBadges {...repo} />
                <span>{repo.dirtyCount} tệp thay đổi</span>
                <span className={repo.merged === true && repo.dirtyCount === 0 ? 'text-success' : 'text-text-muted'}>{deliveryLabel(repo)}</span>
                {pullRequest?.ci === 'red' && machine.state === 'online' && ciSession !== undefined && path !== undefined && (
                  <button
                    type="button"
                    disabled={busy}
                    className="company-btn company-btn-sm company-btn-ghost"
                    onClick={() => fleetStore.sendCloudComment({
                      machine: machine.agentId,
                      path,
                      session: ciSession.name,
                      branch: repo.branch,
                      file: `CI / PR #${pullRequest.number}`,
                      line: 1,
                      snippet: pullRequest.failedChecks.join('\n').slice(0, 1200),
                      content: `CI đỏ · PR #${pullRequest.number} · ${pullRequest.url}. Hãy xử lý lỗi CI; không tự gộp.`,
                    })}
                  >
                    Gửi lỗi CI cho agent
                  </button>
                )}
                {analysis !== undefined ? <BranchAnalysisDetails analysis={analysis} /> : null}
                {path ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="company-btn company-btn-sm company-btn-ghost ml-auto"
                    onClick={() => fleetStore.requestDiff(machine.agentId, path)}
                  >
                    Xem thay đổi
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-hairline pt-2 text-xs text-text-muted">Chưa có repository được báo cáo.</p>
      )}
    </article>
  );
}

/** `/data/home/wt/backend-x/.lavish/plan.html` -> `backend-x/.lavish/plan.html`. */
function shortPath(file: string): string {
  return file.replace(/^\/data\/home\/(wt\/)?/, '');
}

function diffLineClass(line: string): string {
  if (line.startsWith('###')) return 'font-semibold text-text';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-success';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-warning';
  if (line.startsWith('@@')) return 'text-accent';
  return 'text-text-secondary';
}

/** Rendering is one element per line: cap it so a huge diff cannot freeze the board. */
const DIFF_MAX_LINES = 4000;

function DiffPanel({
  diff,
  snapshot,
  busy,
}: {
  diff: NonNullable<FleetState['diff']>;
  snapshot: FleetState['snapshot'];
  busy: boolean;
}) {
  const lines = diff.text.split('\n');
  const shown = lines.slice(0, DIFF_MAX_LINES);
  const selector = useMemo(() => createFleetDiffCommentSelector(diff.text), [diff.text]);
  const [selection, setSelection] = useState<FleetDiffCommentSelection | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ readonly start: number; readonly end: number } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const machine = snapshot?.machines.find((item) => item.agentId === diff.machine);
  const repo = machine?.repos.find((item) => item.path === diff.path);
  const commentSession =
    machine === undefined || repo === undefined
      ? undefined
      : (machine.tmuxSessions ?? []).find(
          (session) =>
            session.branch === repo.branch &&
            typeof session.cwd === 'string' &&
            (session.cwd === diff.path || session.cwd.startsWith(`${diff.path}/`)),
        );
  const canComment =
    machine?.state === 'online' &&
    repo !== undefined &&
    commentSession !== undefined &&
    selection !== null &&
    content.trim() !== '' &&
    !busy;

  function selectLine(index: number, shift: boolean): void {
    const start = shift && anchor !== null ? anchor : index;
    const next = selector.select(start, index);
    if (next === null) return;
    setAnchor(start);
    setSelection(next);
    setSelectedRange({ start: Math.min(start, index), end: Math.max(start, index) });
  }

  function sendComment(): void {
    if (!canComment || machine === undefined || repo?.path === undefined || commentSession === undefined || selection === null) {
      return;
    }
    fleetStore.sendCloudComment({
      machine: machine.agentId,
      path: repo.path,
      session: commentSession.name,
      branch: repo.branch,
      file: selection.file,
      line: selection.line,
      snippet: selection.snippet,
      content,
    });
  }

  return (
    <section className="flex max-h-[70vh] flex-col rounded border border-hairline bg-well">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="break-all font-mono text-sm text-text">
          {diff.machine} · {diff.path}
        </span>
        {diff.truncated ? <span className="text-xs text-warning">Đã cắt bớt (quá 300 KB)</span> : null}
        <button type="button" className="company-btn company-btn-sm company-btn-ghost" onClick={() => fleetStore.closeDiff()}>
          Đóng
        </button>
      </header>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">
        {shown.map((line, index) => {
          const canSelect = selector.select(index) !== null;
          const selected = selectedRange !== null && index >= selectedRange.start && index <= selectedRange.end;
          return (
            <button
              key={index}
              type="button"
              disabled={!canSelect}
              aria-pressed={selected}
              onClick={(event) => selectLine(index, event.shiftKey)}
              className={`block w-full bg-transparent text-left font-mono text-xs leading-5 ${diffLineClass(line)} ${
                canSelect ? 'cursor-pointer hover:bg-accent/10' : 'cursor-default'
              } ${selected ? 'bg-accent/15' : ''}`}
            >
              {line || ' '}
            </button>
          );
        })}
        {lines.length > shown.length ? (
          <div className="text-warning">… còn {lines.length - shown.length} dòng. Xem đủ bằng git diff trong terminal.</div>
        ) : null}
      </pre>
      <div className="space-y-2 border-t border-hairline p-3">
        <p className="text-xs text-text-muted">
          {selection === null
            ? 'Chọn dòng trong diff; Shift+click để chọn một đoạn trong cùng tệp.'
            : `Đang nhận xét ${selection.file}:${selection.line}. Shift+click để mở rộng đoạn.`}
        </p>
        <textarea
          aria-label="Bình luận về diff"
          rows={3}
          maxLength={4_000}
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          className="company-input w-full resize-y text-sm"
          placeholder="Viết bình luận gửi tới phiên cloud…"
        />
        {machine?.state === 'online' && commentSession === undefined ? (
          <p className="text-xs text-warning">Không có phiên tmux đang mở trên nhánh này để nhận bình luận.</p>
        ) : null}
        <div className="flex justify-end">
          <button type="button" disabled={!canComment} onClick={sendComment} className="company-btn company-btn-sm company-btn-primary">
            Gửi bình luận
          </button>
        </div>
      </div>
    </section>
  );
}

/** Same three steps the local board shows: only on the branch, on staging, in main. */
/** Status of the committed HEAD; uncommitted edits are called out so they are not read as delivered. */
function deliveryLabel(repo: FleetMachineSnapshot['repos'][number]): string {
  const step = repo.merged === true ? 'đã vào main' : repo.staged === true ? 'đã lên staging' : repo.merged === false ? 'chỉ trên nhánh' : '';
  if (step === '' || repo.dirtyCount === 0) return step;
  return `${step} (phần đã commit) · còn ${repo.dirtyCount} tệp chưa commit`;
}
