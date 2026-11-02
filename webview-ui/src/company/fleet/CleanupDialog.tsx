import { useState } from 'react';

import type { FleetCleanupItem, FleetCleanupProgressMessage, FleetOverlapWarning } from '../../../../core/src/messages.js';
import { cleanupView, keyOf } from './cleanupView.js';
import type { FleetCleanupState } from './fleetStore.js';

const STEP_LABEL: Record<FleetCleanupProgressMessage['step'], string> = {
  backup: 'Sao lưu',
  tests: 'Chạy test',
  staging: 'Đưa lên staging',
  readback: 'Kiểm tra trên staging',
  clean: 'Dọn thư mục',
};

const STATUS_LABEL: Record<FleetCleanupProgressMessage['status'], { text: string; className: string }> = {
  running: { text: 'đang chạy', className: 'text-warning' },
  ok: { text: 'xong', className: 'text-success' },
  failed: { text: 'lỗi', className: 'text-danger' },
  skipped: { text: 'bỏ qua', className: 'text-text-muted' },
};

export interface CleanupDialogProps {
  readonly cleanup: FleetCleanupState;
  readonly overlaps: readonly FleetOverlapWarning[];
  readonly onRefresh: () => void;
  readonly onStart: (staging: { machine: string; path: string; branch: string }[], junk: { machine: string; path: string }[]) => void;
  readonly onClose: () => void;
  /** Tick keys to start with; the dialog itself always starts with nothing ticked. */
  readonly initialTicked?: readonly string[];
}

function ItemRow({ item, checked, disabled, onToggle }: { item: FleetCleanupItem; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <li className="rounded border border-hairline bg-well px-3 py-2 text-xs">
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="mt-0.5" />
        <span className="min-w-0">
          <span className="font-mono font-semibold text-text">{item.branch ?? '(không có nhánh)'}</span>{' '}
          <span className="font-mono text-text-muted">{item.machine}</span>
          <span className="mt-1 block break-all font-mono text-text-muted">{item.path}</span>
          <span className="mt-1 block text-text">{item.reason}</span>
        </span>
      </label>
    </li>
  );
}

function ProgressList({ events }: { events: readonly FleetCleanupProgressMessage[] }) {
  if (events.length === 0) return <p className="text-xs text-text-muted">Đang bắt đầu…</p>;
  return (
    <ul className="space-y-1">
      {events.map((event, index) => {
        const status = STATUS_LABEL[event.status];
        return (
          <li key={`${event.machine}${event.path}${event.step}${index}`} className="text-xs">
            <span className="font-mono text-text">{event.branch ?? event.path}</span>{' '}
            <span className="text-text-muted">· {STEP_LABEL[event.step]}</span>{' '}
            <span className={status.className}>{status.text}</span>
            {event.detail !== undefined && <span className="block break-words text-text-muted">{event.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function CleanupDialog({ cleanup, overlaps, onRefresh, onStart, onClose, initialTicked = [] }: CleanupDialogProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(initialTicked));
  const plan = cleanup.plan;
  const run = cleanup.run;
  const running = run !== null && run.done === null;
  const view = cleanupView(plan, ticked, overlaps);
  const toggle = (item: FleetCleanupItem): void => {
    const next = new Set(ticked);
    const key = keyOf(item);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setTicked(next);
  };
  const start = (): void => onStart(
    view.staging.map((item) => ({ machine: item.machine, path: item.path, branch: item.branch as string })),
    view.junk.map((item) => ({ machine: item.machine, path: item.path })),
  );

  return (
    <section aria-labelledby="fleet-cleanup-title" className="space-y-3 rounded border border-hairline bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="fleet-cleanup-title" className="text-sm font-semibold text-text">Dọn & lên staging</h2>
        <div className="flex gap-2">
          <button type="button" disabled={running} onClick={onRefresh} className="company-btn company-btn-sm company-btn-ghost">Tải lại kế hoạch</button>
          <button type="button" onClick={onClose} className="company-btn company-btn-sm company-btn-ghost">Đóng</button>
        </div>
      </div>
      {cleanup.error !== null && <p role="alert" className="text-xs text-danger">{cleanup.error}</p>}
      {plan === null ? (
        <p className="text-sm text-text-muted">{cleanup.planRequestId === null ? 'Chưa tải kế hoạch.' : 'Đang đọc các máy cloud…'}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">Chưa chọn gì thì chưa chạy gì. Nhánh lên staging từng cái một; thư mục rác được sao lưu rồi mới dọn, và không bao giờ ép xóa.</p>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-text">Nhánh có việc dở ({plan.staging.length})</h3>
            {plan.staging.length === 0 ? <p className="text-xs text-text-muted">Không có.</p> : (
              <ul className="space-y-1">{plan.staging.map((item) => <ItemRow key={keyOf(item)} item={item} checked={ticked.has(keyOf(item))} disabled={running} onToggle={() => toggle(item)} />)}</ul>
            )}
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-text">Thư mục rác ({plan.junk.length})</h3>
            {plan.junk.length === 0 ? <p className="text-xs text-text-muted">Không có.</p> : (
              <ul className="space-y-1">{plan.junk.map((item) => <ItemRow key={keyOf(item)} item={item} checked={ticked.has(keyOf(item))} disabled={running} onToggle={() => toggle(item)} />)}</ul>
            )}
          </div>
          {plan.kept.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-text-muted">Giữ lại, không đụng tới ({plan.kept.length})</summary>
              <ul className="mt-1 space-y-1">
                {plan.kept.map((item) => (
                  <li key={keyOf(item)} className="text-text-muted"><span className="font-mono">{item.branch ?? item.path}</span> · {item.machine} · {item.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {view.blocked.length > 0 && (
        <p role="alert" className="text-xs text-danger">
          Chưa thể bắt đầu: {view.blocked.map((pair) => `${pair.a.branch} ↔ ${pair.b.branch} (${pair.verdict === 'conflict' ? 'xung đột' : 'chưa kiểm xong'})`).join('; ')}. Bỏ tick một trong hai hoặc gỡ xung đột trước.
        </p>
      )}
      <button type="button" disabled={!view.canStart || running} onClick={start} className="company-btn company-btn-md company-btn-primary">Bắt đầu</button>
      {run !== null && <ProgressList events={run.events} />}
      {run?.done != null && (
        <div role="status" className="space-y-1 text-xs">
          {run.done.refused !== undefined && <p className="text-danger">{run.done.refused}</p>}
          <p className="text-text">
            {run.done.staged} nhánh đã lên staging · {run.done.cleaned} thư mục đã dọn · {run.done.failed} lỗi · {run.done.skipped} bỏ qua.
          </p>
          <p className="text-text-muted">Chưa có gì được đưa lên main hay production. Muốn đưa lên production, bạn cần ra lệnh riêng.</p>
        </div>
      )}
    </section>
  );
}
