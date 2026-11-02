// The local reporter runs remote commands only when the config asks for it with a real `true`, and hands the hub's reply back.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseConfig, sendReport } from './local-agent.mjs';

const text = (extra = {}) => JSON.stringify({ hub: 'https://hub.example', roots: ['/r'], id: 'local-pc', ...extra });

test('TC-LOCALCMD-01: commands are off unless the config says true', () => {
  assert.equal(parseConfig(text()).commands, false);
  assert.equal(parseConfig(text({ commands: 'true' })).commands, false);
  assert.equal(parseConfig(text({ commands: 1 })).commands, false);
  assert.equal(parseConfig(text({ commands: true })).commands, true);
});

test('TC-LOCALCMD-02: sendReport returns the hub reply, and an unreadable reply reads as empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'localcmd-'));
  const keyPath = join(dir, 'k.pem');
  writeFileSync(keyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const config = { hub: 'https://hub.example', keyPath, id: 'local-pc' };
  const reply = await sendReport(config, { agent_id: 'local-pc' }, async () => ({ status: 200, json: async () => ({ ok: true, commands: [{ id: 'x' }] }) }));
  assert.deepEqual(reply.commands, [{ id: 'x' }]);
  const broken = await sendReport(config, { agent_id: 'local-pc' }, async () => ({ status: 200, json: async () => { throw new Error('html'); } }));
  assert.deepEqual(broken, {});
});

test('TC-LOCALCMD-03: a command queued on a real hub runs on the reporter and its result comes back as success', async () => {
  const { createHub } = await import('./hub.mjs');
  const { signJwt } = await import('./jwt.mjs');
  const { runDelivered, loadPendingResults } = await import('./commands.mjs');
  const pair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  };
  const machine = pair(), boss = pair(), board = pair();
  const dir = mkdtempSync(join(tmpdir(), 'localcmd-e2e-'));
  const keysPath = join(dir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ 'local-pc': { pub: machine.pub, role: 'report' }, boss: { pub: boss.pub, role: 'command' }, board: { pub: board.pub, role: 'read' } }));
  const hub = createHub({ keysPath, statePath: join(dir, 'state.json') });
  await new Promise((resolve) => hub.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${hub.address().port}`;
    const keyPath = join(dir, 'machine.pem');
    writeFileSync(keyPath, machine.priv);
    // sendReport insists on https for the config; the hub under test is plain http, so the same request is made through a fetcher.
    const config = { hub: 'https://hub.example', keyPath, id: 'local-pc' };
    const viaHub = (input, init) => fetch(new URL(new URL(String(input)).pathname, url), init);
    const resultsFile = join(dir, 'results.json');
    const deps = { machine: 'local-pc', now: Date.now, lanes: () => ['/repo/wt'], snapshot: () => ({ ref: 'refs/wip/local-pc/feat', commit: 'a'.repeat(40), omitted: [] }) };
    const round = async () => {
      const reply = await sendReport(config, { agent_id: 'local-pc', repos: [], results: loadPendingResults(resultsFile) }, viaHub);
      await runDelivered(reply.commands, { enabled: true, file: resultsFile, deps });
    };

    await round();
    const queued = await fetch(`${url}/v1/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signJwt({ iss: 'boss', aud: 'fleet-hub', role: 'command' }, boss.priv)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'local-pc', verb: 'snapshot-push', args: { path: '/repo/wt' } }),
    });
    assert.equal(queued.status, 200);
    await round(); // receives and runs it
    await round(); // reports the result
    const history = await (await fetch(`${url}/v1/commands`, { headers: { Authorization: `Bearer ${signJwt({ iss: 'board', aud: 'fleet-hub', role: 'read' }, board.priv)}` } })).json();
    assert.equal(history.commands[0].state, 'success');
    assert.match(history.commands[0].result.detail, /refs\/wip\/local-pc\/feat/);
  } finally {
    hub.close();
  }
});
