import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { FleetMachineSnapshot } from '../../../../core/src/messages.js';
import { CompanyButton } from '../components/CompanyButton.js';
import { fleetStore } from './fleetClient.js';
import { lastSeenLabel } from './sleepingMachines.js';

/**
 * The cloud machines that are asleep, each with its own wake button. Waking is the user's click only: the board
 * never starts a machine on its own (a started machine bills until it suspends again).
 */
export function SleepingMachinesDialog({
  machines,
  wakingMachine,
  busy,
  onClose,
}: {
  machines: readonly FleetMachineSnapshot[];
  /** The machine a wake request is in flight for, if any. */
  wakingMachine: string | null;
  busy: boolean;
  onClose: () => void;
}) {
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return createPortal(
    <div className="company-ui">
      <div className="fixed inset-0 z-40 flex items-center justify-center">
        <button type="button" aria-label="Đóng danh sách máy ngủ" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sleeping-machines-title"
          onKeyDown={onKeyDown}
          className="relative flex max-h-[80vh] w-[min(420px,92vw)] flex-col gap-3 overflow-hidden rounded-(--company-radius-md) bg-panel p-3 text-xs text-text max-md:w-full max-md:rounded-none"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 id="sleeping-machines-title" className="text-sm text-text">
              Máy đang ngủ ({machines.length})
            </h2>
            <CompanyButton autoFocus type="button" size="sm" onClick={onClose}>
              Đóng
            </CompanyButton>
          </header>
          <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {machines.map((machine) => (
              <li key={machine.agentId} className="flex items-center gap-2 rounded bg-well px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-text">{machine.agentId}</span>
                  <span className="block text-2xs text-text-muted">Lần cuối thấy: {lastSeenLabel(machine.receivedAt)}</span>
                </span>
                <CompanyButton
                  type="button"
                  size="sm"
                  variant="accent"
                  disabled={busy}
                  title="Bật máy này (máy tính tiền khi chạy). Mất 1–2 phút."
                  onClick={() => fleetStore.wakeMachine(machine.agentId)}
                >
                  {wakingMachine === machine.agentId ? 'Đang bật…' : 'Đánh thức'}
                </CompanyButton>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
