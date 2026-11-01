import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ShareRequest } from '../agentMenu.js';
import { copyText } from '../clipboard.js';
import { CompanyButton } from '../components/CompanyButton.js';
import { fleetStore } from '../fleet/fleetClient.js';
import { useFleetState } from '../fleet/fleetStore.js';
import { shareStore } from './shareClient.js';
import { isLoopbackHostname, shareUrl } from './shareLink.js';
import { useShareState } from './shareStore.js';

const LIFETIMES = [
  { minutes: 60, label: '1 giờ' },
  { minutes: 24 * 60, label: '24 giờ' },
  { minutes: 7 * 24 * 60, label: '7 ngày' },
] as const;
const DEFAULT_LIFETIME_MINUTES = 24 * 60;

function expiryLabel(expiresAt: number): string {
  return new Date(expiresAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

/**
 * Share a session (cloud, omp run by the board, or a herdr pane) as a link that shows its screen
 * read-only. The link opens through the address the board itself was opened on, so it reaches
 * exactly the people who can reach the board (the tailnet, when it is served through Tailscale).
 */
export function ShareDialog({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const cloud = request.kind === 'cloud' ? request : null;
  const fleet = useFleetState(fleetStore);
  const shares = useShareState(shareStore);
  const [minutes, setMinutes] = useState<number>(DEFAULT_LIFETIME_MINUTES);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const label = cloud === null ? request.name : `${cloud.machine} · ${request.name}`;
  const alreadyOpen = fleet.terminal !== null && cloud !== null && fleet.terminal.machine === cloud.machine && fleet.terminal.session === cloud.session;
  // True while the terminal in the drawer was opened by this dialog, so it is the dialog's to close again.
  const openedHere = useRef(false);

  useEffect(() => {
    shareStore.reset();
    shareStore.refresh();
  }, []);

  // The terminal opens first (the board holds one PTY per cloud session), then the link names it.
  useEffect(() => {
    if (!opening || cloud === null) return;
    const terminal = fleet.terminal;
    if (terminal !== null && terminal.machine === cloud.machine && terminal.session === cloud.session) {
      setOpening(false);
      if (openedHere.current) fleetStore.closeTerminal();
      openedHere.current = false;
      shareStore.create({ target: { kind: 'cloud', terminalId: terminal.terminalId }, label, ttlMinutes: minutes });
    } else if (fleet.action === null && fleet.actionError !== null) {
      setOpening(false);
      openedHere.current = false;
    }
  }, [opening, cloud, fleet.terminal, fleet.action, fleet.actionError, label, minutes]);

  function create(): void {
    shareStore.reset();
    if (request.kind === 'company') {
      shareStore.create({ target: { kind: 'company', sessionId: request.sessionId }, label, ttlMinutes: minutes });
      return;
    }
    if (request.kind === 'herdr') {
      shareStore.create({ target: { kind: 'herdr', paneId: request.paneId }, label, ttlMinutes: minutes });
      return;
    }
    if (cloud === null) return;
    if (alreadyOpen && fleet.terminal !== null) {
      // Already open in the drawer: use it and leave the drawer as the reader had it.
      shareStore.create({ target: { kind: 'cloud', terminalId: fleet.terminal.terminalId }, label, ttlMinutes: minutes });
      return;
    }
    openedHere.current = true;
    setOpening(true);
    fleetStore.openTerminal(cloud.machine, cloud.session);
  }

  function copy(token: string): void {
    void copyText(shareUrl(window.location.origin, token)).then((ok) => setCopied(ok ? token : null));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  const created = shares.createdToken;
  const busy = opening || shares.busy || (cloud !== null && fleet.action !== null);
  const error = shares.error ?? (cloud === null || opening ? null : fleet.actionError);

  return createPortal(
    <div className="company-ui">
      <div className="fixed inset-0 z-40 flex items-center justify-center">
        <button type="button" aria-label="Đóng hộp share" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-title"
          data-testid="share-dialog"
          onKeyDown={onKeyDown}
          className="relative flex max-h-[85vh] w-[min(520px,94vw)] flex-col gap-3 overflow-y-auto rounded-(--company-radius-md) bg-panel p-3 text-xs text-text max-md:w-full max-md:rounded-none"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 id="share-title" className="min-w-0 truncate text-sm text-text">Share session · {request.name}</h2>
            <CompanyButton autoFocus type="button" size="sm" onClick={onClose}>Đóng</CompanyButton>
          </header>

          <p className="text-text-muted">
            Người nhận mở link để xem màn hình phiên trực tiếp, chỉ đọc: không gõ, không điều khiển được. Chỉ người vào được địa chỉ
            board này (trong mạng Tailscale của bạn) mới mở được.
          </p>
          {isLoopbackHostname(window.location.hostname) && (
            <p role="note" data-testid="share-loopback-warning" className="rounded bg-warning/12 px-2 py-1.5 text-warning">
              Bạn đang mở board bằng địa chỉ chỉ máy này truy cập được ({window.location.host}), nên link tạo ra không mở được trên máy khác.
              Mở board qua địa chỉ Tailscale (khởi động board với <code>--allowed-host &lt;máy&gt;.&lt;tailnet&gt;.ts.net</code>) rồi tạo lại link.
            </p>
          )}
          <p role="note" className="text-text-muted">
            Lưu ý: người xem thấy mọi thứ terminal in ra, kể cả khoá hay token nếu agent in chúng.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              Hết hạn sau
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                disabled={busy}
                className="rounded bg-well px-1.5 py-1 text-text"
              >
                {LIFETIMES.map((option) => (
                  <option key={option.minutes} value={option.minutes}>{option.label}</option>
                ))}
              </select>
            </label>
            <CompanyButton type="button" variant="accent" disabled={busy} onClick={create} data-testid="share-create">
              {opening || shares.busy ? 'Đang tạo…' : 'Tạo link'}
            </CompanyButton>
          </div>

          {error !== null && <p role="alert" className="text-danger">{error}</p>}

          {created !== null && (
            <div data-testid="share-created" className="flex items-center gap-2 rounded bg-well px-2 py-1.5">
              <input
                readOnly
                aria-label="Link xem trực tiếp"
                value={shareUrl(window.location.origin, created)}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent font-mono text-text outline-none"
              />
              <CompanyButton type="button" size="sm" variant="accent" onClick={() => copy(created)}>
                {copied === created ? 'Đã chép' : 'Chép link'}
              </CompanyButton>
            </div>
          )}

          <section aria-label="Link đang share" className="flex flex-col gap-1">
            <h3 className="text-text-muted">Đang share ({shares.shares.length})</h3>
            {shares.shares.length === 0 && <p className="text-text-muted">Chưa có link nào.</p>}
            <ul className="flex flex-col gap-1">
              {shares.shares.map((share) => (
                <li key={share.token} data-testid="share-row" className="flex items-center gap-2 rounded bg-well px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{share.label}</span>
                    <span className="block text-2xs text-text-muted">Hết hạn {expiryLabel(share.expiresAt)}</span>
                  </span>
                  <CompanyButton type="button" size="sm" onClick={() => copy(share.token)}>
                    {copied === share.token ? 'Đã chép' : 'Chép link'}
                  </CompanyButton>
                  <CompanyButton type="button" size="sm" disabled={shares.busy} onClick={() => shareStore.revoke(share.token)}>
                    Dừng
                  </CompanyButton>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
