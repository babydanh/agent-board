import { describe, expect, it, vi } from 'vitest';

import type { GitRunner } from '../src/ledger/git.js';
import { LibraryUserError } from '../src/library/libraryError.js';
import { handleProjectMessage } from '../src/projects/handler.js';
import { listStoppedSessions } from '../src/projects/stoppedSessions.js';
import { FakeLedgerSource, sessionRow } from './ledgerFixtures.js';

/** Ledger wall-clock text for the n-th minute of a fixed day. */
const at = (minute: number, day = 20): string => `2026-10-${String(day).padStart(2, '0')} 10:${String(minute).padStart(2, '0')}:00`;

function source(...rows: ReturnType<typeof sessionRow>[]): FakeLedgerSource {
  return new FakeLedgerSource({ sessions: rows });
}

const ids = (items: readonly { sessionId?: string }[]) => items.map((item) => item.sessionId);

describe('listStoppedSessions', () => {
  it('keeps every ended main session, however old, and pages them newest first by cursor', async () => {
    const rows = Array.from({ length: 25 }, (_, minute) => sessionRow(`e${minute}`, { cwd: 'C:/w', endedAt: at(minute, 5) }));
    const ledger = source(...rows, sessionRow('live', { cwd: 'C:/w' }), sessionRow('sub', { cwd: 'C:/w', agentKind: 'sub', endedAt: at(30) }));

    const first = await listStoppedSessions({ ledger }, { limit: 10 });
    expect(ids(first.items)).toEqual(Array.from({ length: 10 }, (_, index) => `e${24 - index}`));
    expect(first.total).toBe(25);
    expect(first.nextCursor).toBeDefined();

    const second = await listStoppedSessions({ ledger }, { limit: 10, cursor: first.nextCursor });
    expect(ids(second.items)).toEqual(Array.from({ length: 10 }, (_, index) => `e${14 - index}`));

    const third = await listStoppedSessions({ ledger }, { limit: 10, cursor: second.nextCursor });
    expect(ids(third.items)).toEqual(['e4', 'e3', 'e2', 'e1', 'e0']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('returns session nodes in the ended state with their stop time and folder', async () => {
    const ledger = source(sessionRow('one', { cwd: 'C:/w/app', endedAt: at(1) }));
    const { items } = await listStoppedSessions({ ledger }, {});
    expect(items[0]).toMatchObject({ kind: 'session', sessionId: 'one', state: 'ended', path: 'C:/w/app' });
    expect(Date.parse(items[0]?.stoppedAt ?? '')).not.toBeNaN();
  });

  it('does not repeat or skip a session when a newer one ends between two pages', async () => {
    const ledger = source(...['a', 'b', 'c', 'd'].map((id, minute) => sessionRow(id, { cwd: 'C:/w', endedAt: at(minute) })));
    const first = await listStoppedSessions({ ledger }, { limit: 2 });
    expect(ids(first.items)).toEqual(['d', 'c']);
    ledger.data.sessions?.push(sessionRow('newer', { cwd: 'C:/w', endedAt: at(50) }));
    const second = await listStoppedSessions({ ledger }, { limit: 2, cursor: first.nextCursor });
    expect(ids(second.items)).toEqual(['b', 'a']);
  });

  it('breaks a tie on the stop time by id so a page boundary never loses one', async () => {
    const ledger = source(...['a', 'b', 'c'].map((id) => sessionRow(id, { cwd: 'C:/w', endedAt: at(7) })));
    const first = await listStoppedSessions({ ledger }, { limit: 2 });
    const second = await listStoppedSessions({ ledger }, { limit: 2, cursor: first.nextCursor });
    expect([...ids(first.items), ...ids(second.items)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges sleeping herdr panes in by their sleep time and skips an ended row a pane already holds', async () => {
    const ledger = source(
      sessionRow('old', { cwd: 'C:/w', endedAt: at(1) }),
      sessionRow('claimed', { cwd: 'C:/w', endedAt: at(2), sessionId: 'claimed' }),
    );
    const herdrSessions = () => [
      { id: 'w1:p1', cwd: 'C:/w', status: 'sleeping', title: 'Ngủ', sleptAt: new Date(2026, 9, 20, 10, 5, 0).toISOString() },
      { id: 'w1:p2', cwd: 'C:/w', status: 'sleeping', title: 'Giữ phiên', sessionId: 'claimed', sleptAt: new Date(2026, 9, 20, 10, 3, 0).toISOString() },
      { id: 'w1:p3', cwd: 'C:/w', status: 'working', title: 'Đang chạy' },
    ];
    const { items } = await listStoppedSessions({ ledger, herdrSessions }, {});
    expect(items.map((item) => item.id)).toEqual(['herdr:w1:p1', 'herdr:w1:p2', 'omp:old']);
  });

  it('reads transcript facts only for the page it returns', async () => {
    const rows = Array.from({ length: 6 }, (_, minute) => sessionRow(`s${minute}`, { cwd: 'C:/w', sessionFile: `C:/s/${minute}.jsonl`, endedAt: at(minute) }));
    const sessionFacts = vi.fn(async (file: string) => ({ request: `from ${file}` }));
    const { items } = await listStoppedSessions({ ledger: source(...rows), sessionFacts }, { limit: 2 });
    expect(sessionFacts).toHaveBeenCalledTimes(2);
    expect(items[0]?.request).toBe('from C:/s/5.jsonl');
  });

  it('filters by folder, agent name or id, and counts only the matches', async () => {
    const ledger = source(
      sessionRow('a1', { cwd: 'C:/w/web', endedAt: at(1) }),
      sessionRow('a2', { cwd: 'C:/w/api', agentName: 'Thanh toán', endedAt: at(2) }),
      sessionRow('zz9', { cwd: 'C:/w/api', endedAt: at(3) }),
    );
    expect(ids((await listStoppedSessions({ ledger }, { query: 'WEB' })).items)).toEqual(['a1']);
    const byName = await listStoppedSessions({ ledger }, { query: 'thanh' });
    expect(ids(byName.items)).toEqual(['a2']);
    expect(byName.total).toBe(1);
    expect(ids((await listStoppedSessions({ ledger }, { query: 'zz9' })).items)).toEqual(['zz9']);
  });

  it('treats a dead process as ended when it was last seen', async () => {
    const ledger = source(sessionRow('killed', { cwd: 'C:/w', pid: 4242, lastSeen: at(9) }));
    const { items } = await listStoppedSessions({ ledger, isAlive: () => false }, {});
    expect(ids(items)).toEqual(['killed']);
  });

  it('answers an empty list with no cursor, and refuses a cursor it cannot read', async () => {
    expect(await listStoppedSessions({ ledger: source() }, {})).toEqual({ items: [], total: 0 });
    await expect(listStoppedSessions({ ledger: source() }, { cursor: 'rác' })).rejects.toBeInstanceOf(LibraryUserError);
  });
});

describe('projectStoppedRequest', () => {
  const git: GitRunner = { run: async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, truncated: false }) };
  const ask = async (message: Record<string, unknown>, context: Parameters<typeof handleProjectMessage>[2]) => {
    const sent: Record<string, unknown>[] = [];
    handleProjectMessage({ type: 'projectStoppedRequest', requestId: 'r1', ...message }, (reply) => sent.push(reply as never), context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return sent;
  };
  const tree = { ledger: source(...Array.from({ length: 3 }, (_, minute) => sessionRow(`s${minute}`, { cwd: 'C:/w', endedAt: at(minute) }))), git };

  it('answers a privileged connection with a page and its cursor', async () => {
    const [page] = await ask({ limit: 2 }, { privileged: true, tree });
    expect(page).toMatchObject({ type: 'projectStoppedPage', requestId: 'r1', ok: true, total: 3 });
    expect((page?.items as unknown[]).length).toBe(2);
    expect(typeof page?.nextCursor).toBe('string');
  });

  it('refuses a connection that is not privileged, and says why', async () => {
    const [page] = await ask({}, { privileged: false, tree });
    expect(page).toMatchObject({ type: 'projectStoppedPage', ok: false, items: [], total: 0 });
    expect(String(page?.reason)).not.toBe('');
  });

  it('answers a bad cursor with a Vietnamese refusal, not silence', async () => {
    const [page] = await ask({ cursor: 'rác' }, { privileged: true, tree });
    expect(page).toMatchObject({ type: 'projectStoppedPage', ok: false, reason: 'Con trỏ trang không hợp lệ.' });
  });

  it('refuses when the activity ledger is not wired', async () => {
    const [page] = await ask({}, { privileged: true });
    expect(page).toMatchObject({ type: 'projectStoppedPage', ok: false });
  });
});
