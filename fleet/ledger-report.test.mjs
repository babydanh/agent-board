// The local reporter reads the activity ledger instead of scanning git, so it costs one SQL query per round (TC-LEDGER).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { buildLedgerReport, ledgerRows, localStamp } from './ledgerReport.mjs';
import { parseConfig } from './local-agent.mjs';

const NOW = Date.UTC(2026, 10, 2, 7, 0, 0);
const minutesAgo = (m) => localStamp(NOW - m * 60_000);

/** A ledger file with the columns the reporter reads; `events` are [kind, minutesAgo, repo, checkout, branch, path]. */
function ledger(events) {
  const file = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'activity.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, ts TEXT, kind TEXT, repo TEXT, checkout TEXT, branch TEXT, path TEXT)');
  const insert = db.prepare('INSERT INTO events (ts, kind, repo, checkout, branch, path) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [kind, ago, repo, checkout, branch, path] of events) insert.run(minutesAgo(ago), kind, repo, checkout, branch, path);
  db.close();
  return file;
}
const R = 'V:/Duancanhan/Project_QuanLyGiaiDau/Web';

test('TC-LEDGER-01: files written in the window are grouped by checkout, relative to it; everything else is left out', () => {
  const file = ledger([
    ['edit', 5, R, R, 'main', `${R}/src/a.ts`],
    ['write', 10, R, R, 'main', `${R}/src/b.ts`],
    ['edit', 12, R, R, 'main', `${R}/src/a.ts`],
    ['edit', 3, R, `${R}.worktrees/fix`, 'fix', `${R}.worktrees/fix/src/a.ts`],
    ['edit', 45, R, R, 'main', `${R}/old.ts`],
    ['bash', 2, R, R, 'main', null],
    ['edit', 2, null, null, null, 'C:/tmp/outside.ts'],
    ['edit', 2, R, R, 'main', 'C:/elsewhere/x.ts'],
  ]);
  const rows = ledgerRows(file, { now: NOW });
  assert.deepEqual(rows.map((row) => [row.path, row.branch, row.dirty_files.sort()]), [
    [R, 'main', ['src/a.ts', 'src/b.ts']],
    [`${R}.worktrees/fix`, 'fix', ['src/a.ts']],
  ]);
  assert.equal(rows[0].repo, 'Web');
});

test('TC-LEDGER-02: the report carries the repository identity once per repository, and is capped at the hub limit', () => {
  const file = ledger([
    ['edit', 1, R, R, 'main', `${R}/a.ts`],
    ['edit', 1, R, `${R}.worktrees/x`, 'x', `${R}.worktrees/x/a.ts`],
  ]);
  const asked = [];
  const report = buildLedgerReport({ id: 'local-pc', ledgerPath: file, now: NOW, originOf: (checkout) => { asked.push(checkout); return 'github.com/o/web'; } });
  assert.equal(report.agent_id, 'local-pc');
  assert.deepEqual(report.repos.map((row) => row.github_repo), ['github.com/o/web', 'github.com/o/web']);
  assert.equal(asked.length, 1);

  const many = ledger(Array.from({ length: 30 }, (_, i) => ['edit', 1, `${R}${i}`, `${R}${i}`, 'main', `${R}${i}/f.ts`]));
  assert.equal(buildLedgerReport({ id: 'local-pc', ledgerPath: many, now: NOW, originOf: () => '' }).repos.length, 20);
});

test('TC-LEDGER-03: a missing ledger is an error that names the file, not an empty report', () => {
  assert.throws(() => ledgerRows(join(tmpdir(), 'no-such-dir', 'activity.db'), { now: NOW }), /activity\.db/);
});

test('TC-LEDGER-04: source "ledger" needs no roots; any other source is refused; the default still needs roots', () => {
  const base = { hub: 'https://hub.example', id: 'local-pc' };
  assert.equal(parseConfig(JSON.stringify({ ...base, source: 'ledger' })).source, 'ledger');
  assert.equal(parseConfig(JSON.stringify({ ...base, roots: ['a'] })).source, 'git');
  assert.throws(() => parseConfig(JSON.stringify({ ...base })), /roots/);
  assert.throws(() => parseConfig(JSON.stringify({ ...base, source: 'magic', roots: ['a'] })), /source/);
});

test('TC-LEDGER-05: a cloud machine and the local ledger editing one file learn of each other through a real hub', async () => {
  const { createHub } = await import('./hub.mjs');
  const { sendReport } = await import('./local-agent.mjs');
  const pair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  };
  const cloud = pair(), local = pair();
  const dir = mkdtempSync(join(tmpdir(), 'ledger-e2e-'));
  const keysPath = join(dir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ danh: { pub: cloud.pub, role: 'report' }, 'local-pc': { pub: local.pub, role: 'report' } }));
  const hub = createHub({ keysPath, statePath: join(dir, 'state.json') });
  await new Promise((resolve) => hub.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${hub.address().port}`;
    const viaHub = (input, init) => fetch(new URL(new URL(String(input)).pathname, url), init);
    const config = (id, pem) => { const keyPath = join(dir, `${id}.pem`); writeFileSync(keyPath, pem); return { hub: 'https://hub.example', keyPath, id }; };
    await sendReport(config('danh', cloud.priv), { agent_id: 'danh', repos: [{ path: '/c/web', branch: 'b', github_repo: 'github.com/o/web', dirty_files: ['src/a.ts'] }] }, viaHub);
    const report = buildLedgerReport({ id: 'local-pc', ledgerPath: ledger([['edit', 1, R, R, 'main', `${R}/src/a.ts`]]), now: NOW, originOf: () => 'github.com/o/web' });
    const reply = await sendReport(config('local-pc', local.priv), report, viaHub);
    assert.deepEqual(reply.overlaps, [{ repo: 'github.com/o/web', file: 'src/a.ts', machines: ['danh'] }]);
  } finally {
    hub.close();
  }
});
