import { useEffect } from 'react';

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
                Mở Lavish
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
          {attached && fleet.actionError !== null && (
            <li role="alert" className="text-xs text-warning">{fleet.actionError}</li>
          )}
        </ul>
      )}
      {attached && (
        <CloudTerminal key={terminal.terminalId} terminalId={terminal.terminalId} label={`${machine} · ${session}`} onClose={onClose} fill />
      )}
      {!attached && (connecting || fleet.actionError === null) && (
        <p role="status" className="text-sm text-text-muted">
          Đang nối tới {machine} ({session})… máy đang ngủ thì mất 1–2 phút.
        </p>
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
