import { useEffect } from 'react';

import { BusyNote } from '../components/BusyNote.js';
import { CloudHistory } from './CloudHistory.js';
import { lavishOfSession, openPendingTab } from './cloudLavish.js';
import { CloudTerminal } from './CloudTerminal.js';
import { fleetStore } from './fleetClient.js';
import { useFleetState } from './fleetStore.js';

/**
 * A cloud tmux session in the detail drawer: its live terminal, like a local agent's. The board server
 * holds one PTY attached to the session; closing the panel only detaches, the agent keeps running.
 * The session's Lavish pages (plans, reports it wrote on the machine) get a button here, not only on the Cloud page.
 */
export function CloudDrawerPanel({ machine, session, onClose }: { machine: string; session: string; onClose: () => void }) {
  const fleet = useFleetState(fleetStore);
  const terminal = fleet.terminal;
  const attached = terminal !== null && terminal.machine === machine && terminal.session === session;
  const connecting = fleet.action?.kind === 'terminal';
  const history = fleet.history !== null && fleet.history.machine === machine && fleet.history.session === session ? fleet.history : null;
  const lavish = lavishOfSession(fleet.snapshot?.machines.find((entry) => entry.agentId === machine)?.lavishSessions, session);

  // Opens once per session shown; a failure is reported below with a retry instead of looping.
  useEffect(() => {
    if (!attached) fleetStore.openTerminal(machine, session);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attached` flips when the open succeeds: not a reason to open again
  }, [machine, session]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      {lavish.length > 0 && (
        <ul className="flex flex-col gap-1 rounded border border-hairline bg-well px-3 py-2">
          {lavish.map((entry) => (
            <li key={entry.key} className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-medium text-text">Lavish</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={entry.file}>{entry.file.replace(/^\/data\/home\/(wt\/)?/, '')}</span>
              <button
                type="button"
                disabled={fleet.action !== null}
                className="company-btn company-btn-sm company-btn-ghost"
                onClick={() => fleetStore.openLavish(machine, entry.key, openPendingTab())}
              >
                {fleet.action?.kind === 'lavish' && fleet.action.session === entry.key ? 'Đang mở…' : 'Mở Lavish'}
              </button>
              <button
                type="button"
                disabled={fleet.action !== null}
                className="company-btn company-btn-sm company-btn-ghost"
                onClick={() => {
                  if (window.confirm(`Xóa trang Lavish ${entry.file.replace(/^\/data\/home\/(wt\/)?/, '')}? Agent cloud có thể tạo lại khi cần.`)) {
                    fleetStore.deleteLavish(machine, entry.key);
                  }
                }}
              >
                {fleet.action?.kind === 'lavishDelete' && fleet.action.session === entry.key ? 'Đang xóa…' : 'Xóa'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {attached && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <CloudTerminal
            key={terminal.terminalId}
            terminalId={terminal.terminalId}
            label={`${machine} · ${session}`}
            onClose={onClose}
            fill
            onHistory={() => fleetStore.requestHistory(machine, session)}
            historyBusy={fleet.action?.kind === 'history'}
            restartBusy={fleet.action?.kind === 'restart'}
            onRestart={() => {
              if (window.confirm('Chạy lại Claude trong phiên này? Claude tắt rồi mở lại đúng hội thoại cũ. Máy từ chối nếu Claude vừa ghi trong 30 giây (có thể đang làm việc).')) {
                fleetStore.restartSession(machine, session);
              }
            }}
          />
          {history !== null && <CloudHistory text={history.text} truncated={history.truncated} label={`${machine} · ${session}`} onClose={fleetStore.closeHistory} />}
        </div>
      )}
      {attached && fleet.actionError !== null && (
        <p role="alert" className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{fleet.actionError}</p>
      )}
      {!attached && (connecting || fleet.actionError === null) && (
        <BusyNote
          skeleton
          text={`Đang nối tới ${machine} (${session})… máy đang ngủ thì mất 1–2 phút.`}
          since={connecting ? fleet.action?.startedAt : undefined}
          onCancel={connecting ? fleetStore.cancelAction : undefined}
        />
      )}
      {!attached && !connecting && fleet.actionError !== null && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>{fleet.actionError}</span>
          <button type="button" className="company-btn company-btn-sm company-btn-ghost self-start" onClick={() => fleetStore.openTerminal(machine, session)}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
