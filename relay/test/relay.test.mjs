// Relay tests: a stand-in "board" (plain HTTP + WebSocket echo) is reached through the gateway by way of a tunnel agent.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, describe, it } from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { createGateway } from '../lib/gateway.js';
import { startAgent } from '../lib/agent.js';

const RELAY_SECRET = 'relay-secret-for-tests-0123456789';
const ACCESS_PASSWORD = 'access-password-for-tests';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => {});
});

async function waitFor(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A fake board: GET/POST echo with a label, plus a WebSocket echo on /ws. */
async function startBoard(label) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.url.startsWith('/headers')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(req.headers));
        return;
      }
      res.setHeader('x-board', label);
      res.setHeader('content-type', 'text/plain');
      res.statusCode = req.url === '/missing' ? 404 : 200;
      res.end(`${label}:${req.method}:${req.url}:${body.length}:${body.length ? body.subarray(0, 8).toString() : ''}`);
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => ws.on('message', (m) => ws.send(`${label}-echo:${m}`)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stop = async () => {
    wss.clients.forEach((c) => c.terminate());
    await new Promise((r) => server.close(r));
  };
  cleanups.push(stop);
  return { port: server.address().port, stop };
}

async function startGateway(extra = {}) {
  const gw = createGateway({ relaySecret: RELAY_SECRET, accessPassword: ACCESS_PASSWORD, ...extra });
  const port = await gw.listen(0);
  cleanups.push(() => gw.close());
  return { gw, port, url: `http://127.0.0.1:${port}` };
}

async function connectAgent(gwPort, boardPort, opts = {}) {
  const agent = startAgent({
    relayUrl: `ws://127.0.0.1:${gwPort}/_relay`,
    secret: RELAY_SECRET,
    boardPort,
    name: 'local',
    priority: 100,
    reconnect: false,
    ...opts,
  });
  cleanups.push(async () => agent.stop());
  return agent;
}

async function login(url, password = ACCESS_PASSWORD) {
  const res = await fetch(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return { res, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}

describe('gateway configuration', () => {
  it('refuses to start without the secrets (fails closed)', () => {
    assert.throws(() => createGateway({ relaySecret: '', accessPassword: ACCESS_PASSWORD }), /RELAY_SECRET/);
    assert.throws(() => createGateway({ relaySecret: RELAY_SECRET, accessPassword: '' }), /ACCESS_PASSWORD/);
    assert.throws(() => createGateway({ relaySecret: 'short', accessPassword: ACCESS_PASSWORD }), /RELAY_SECRET/);
  });
});

describe('access control', () => {
  it('answers health publicly without revealing backends', async () => {
    const { url } = await startGateway();
    const res = await fetch(`${url}/relay/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('redirects an unauthenticated browser to /login and refuses API callers', async () => {
    const { url } = await startGateway();
    const html = await fetch(`${url}/anything`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(html.status, 302);
    assert.match(html.headers.get('location'), /^\/login/);
    const api = await fetch(`${url}/anything`, { redirect: 'manual', headers: { accept: 'application/json' } });
    assert.equal(api.status, 401);
  });

  it('rejects a wrong password, accepts the right one and sets a hardened cookie', async () => {
    const { url } = await startGateway();
    assert.equal((await login(url, 'nope')).res.status, 401);
    const { res, cookie } = await login(url);
    assert.equal(res.status, 200);
    assert.match(cookie, /^relay=/);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
  });

  it('after a form login only redirects to a path on this site', async () => {
    const { url } = await startGateway();
    const submit = async (next) => {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: ACCESS_PASSWORD, next }),
      });
      assert.equal(res.status, 303);
      return res.headers.get('location');
    };
    assert.equal(await submit('/files?x=1'), '/files?x=1');
    assert.equal(await submit('//evil.example'), '/');
    assert.equal(await submit('/\\evil.example'), '/');
    assert.equal(await submit('https://evil.example'), '/');
  });

  it('rate-limits repeated wrong passwords', async () => {
    const { url } = await startGateway();
    for (let i = 0; i < 5; i++) await login(url, `bad-${i}`);
    assert.equal((await login(url, 'bad-again')).res.status, 429);
    assert.equal((await login(url)).res.status, 429, 'even the right password waits out the lockout');
  });

  it('does not accept a forged cookie', async () => {
    const { url } = await startGateway();
    const res = await fetch(`${url}/anything`, { headers: { cookie: 'relay=9999999999999.deadbeef', accept: 'application/json' } });
    assert.equal(res.status, 401);
  });
});

describe('tunnel agents', () => {
  it('ignores an agent with the wrong secret', async () => {
    const { gw, port } = await startGateway();
    const board = await startBoard('A');
    const agent = await connectAgent(port, board.port, { secret: 'x'.repeat(30) });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(gw.backends().length, 0);
    agent.stop();
  });

  it('shows 503 when no board is online', async () => {
    const { url } = await startGateway();
    const { cookie } = await login(url);
    const res = await fetch(`${url}/anything`, { headers: { cookie, accept: 'application/json' } });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'no_backend');
  });

  it('passes HTTP through, keeps status and headers, and carries request bodies intact', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);

    const get = await fetch(`${url}/api/health?x=1`, { headers: { cookie } });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('x-board'), 'A');
    assert.equal(await get.text(), 'A:GET:/api/health?x=1:0:');

    assert.equal((await fetch(`${url}/missing`, { headers: { cookie } })).status, 404);

    const big = Buffer.alloc(1_500_000, 'z');
    const post = await fetch(`${url}/upload`, { method: 'POST', headers: { cookie }, body: big });
    assert.equal(await post.text(), 'A:POST:/upload:1500000:zzzzzzzz');
  });

  it('accepts the access password as a bearer key for API callers', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const res = await fetch(`${url}/api/health`, { headers: { authorization: `Bearer ${ACCESS_PASSWORD}` } });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'A:GET:/api/health:0:');
  });

  it('does not forward the relay cookie or bearer key to the board', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);
    const res = await fetch(`${url}/headers`, { headers: { cookie: `${cookie}; keep=1` } });
    const seen = await res.json();
    assert.equal(seen.cookie, 'keep=1');
    const bearer = await fetch(`${url}/headers`, { headers: { authorization: `Bearer ${ACCESS_PASSWORD}` } });
    assert.equal((await bearer.json()).authorization, undefined);
  });

  it('sends a logged-in browser to the board URL carrying the board token', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port, { boardToken: 'board-token-abc' });
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);
    const res = await fetch(`${url}/`, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?token=board-token-abc');
    const withToken = await fetch(`${url}/?token=board-token-abc`, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' });
    assert.equal(withToken.status, 200);
  });

  it('does not list board tokens in the status endpoint', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port, { boardToken: 'board-token-abc' });
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);
    const text = await (await fetch(`${url}/relay/status`, { headers: { cookie } })).text();
    assert.ok(!text.includes('board-token-abc'));
    const status = JSON.parse(text);
    assert.equal(status.active, 'local');
    assert.equal(status.backends[0].name, 'local');
  });

  it('passes WebSocket through and refuses an unauthenticated upgrade', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    const reply = await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send('hello'));
      ws.on('message', (m) => resolve(String(m)));
      ws.on('error', reject);
    });
    assert.equal(reply, 'A-echo:hello');
    ws.close();

    const anon = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise((resolve) => {
      anon.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      anon.on('open', () => resolve('connected without a login'));
      anon.on('error', () => {});
      setTimeout(() => resolve('no answer'), 3000).unref();
    });
    anon.terminate();
    assert.equal(code, 401);
  });

  it('prefers the highest priority board, falls back when it leaves, and 503s when none remain', async () => {
    const { gw, port, url } = await startGateway();
    const local = await startBoard('LOCAL');
    const cloud = await startBoard('CLOUD');
    const cloudAgent = await connectAgent(port, cloud.port, { name: 'cloud', priority: 10 });
    const localAgent = await connectAgent(port, local.port, { name: 'local', priority: 100 });
    await waitFor(() => gw.backends().length === 2, 'both agents');
    const { cookie } = await login(url);

    assert.match(await (await fetch(`${url}/x`, { headers: { cookie } })).text(), /^LOCAL:/);
    localAgent.stop();
    await waitFor(() => gw.backends().length === 1, 'local leaving');
    assert.match(await (await fetch(`${url}/x`, { headers: { cookie } })).text(), /^CLOUD:/);
    cloudAgent.stop();
    await waitFor(() => gw.backends().length === 0, 'cloud leaving');
    assert.equal((await fetch(`${url}/x`, { headers: { cookie, accept: 'application/json' } })).status, 503);
  });

  it('shuts down promptly even while a proxied WebSocket is still open', async () => {
    const gw = createGateway({ relaySecret: RELAY_SECRET, accessPassword: ACCESS_PASSWORD });
    const port = await gw.listen(0);
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(`http://127.0.0.1:${port}`);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    const outcome = await Promise.race([gw.close().then(() => 'closed'), new Promise((r) => setTimeout(() => r('hung'), 3000))]);
    ws.terminate();
    assert.equal(outcome, 'closed');
  });

  it('gives a 502 when the board behind an agent is down', async () => {
    const { gw, port, url } = await startGateway();
    const board = await startBoard('A');
    await connectAgent(port, board.port);
    await waitFor(() => gw.backends().length === 1, 'agent registration');
    const { cookie } = await login(url);
    await board.stop();
    const res = await fetch(`${url}/x`, { headers: { cookie, accept: 'application/json' } });
    assert.equal(res.status, 502);
  });
});
