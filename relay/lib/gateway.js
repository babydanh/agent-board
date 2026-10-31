// The relay gateway: a public, password-protected HTTPS front that forwards every request and WebSocket to the
// highest-priority board that is currently connected through a tunnel agent (a board dials OUT to /_relay).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { WebSocketServer } from 'ws';

import { Mux } from './mux.js';

const COOKIE_NAME = 'relay';
const SESSION_MS = 30 * 86_400_000;
const HELLO_TIMEOUT_MS = 5_000;
const PING_MS = 20_000;
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 10 * 60_000;
const MAX_LOGIN_BODY = 4_096;
const MAX_AGENT_MESSAGE = 4 * 1024 * 1024;
const MIN_RELAY_SECRET = 24;
const MIN_ACCESS_PASSWORD = 12;
const RETRY_AFTER_S = 10;
const AGENT_NAME = /^[\w.-]{1,40}$/;
const MAX_BOARD_TOKEN = 256;
const MAX_PRIORITY = 1000;
/** Headers that describe one hop, not the message; each hop sets its own. */
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'upgrade']);

const digest = (value) => createHash('sha256').update(String(value)).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const wantsHtml = (req) => req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function page(res, status, title, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>` +
      '<style>body{font:16px system-ui,sans-serif;background:#14110f;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}' +
      'main{max-width:22rem;padding:1.5rem}input,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.6rem;border-radius:6px;border:1px solid #555}' +
      'button{background:#e0a030;color:#111;border:0;font-weight:600}</style>' +
      `<main>${body}</main>`,
  );
}

function clientIp(req) {
  // Behind one reverse proxy the LAST entry is the address the proxy itself saw; earlier ones are client-supplied.
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded.at(-1) ?? req.socket.remoteAddress ?? 'unknown';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

/** The cookie header without the relay's own cookie, or undefined when nothing else is left. */
function forwardCookie(header) {
  const kept = String(header ?? '').split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith(`${COOKIE_NAME}=`));
  return kept.length ? kept.join('; ') : undefined;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_LOGIN_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createGateway({ relaySecret, accessPassword, host = '0.0.0.0', log = () => {} } = {}) {
  if (typeof relaySecret !== 'string' || relaySecret.length < MIN_RELAY_SECRET) {
    throw new Error(`RELAY_SECRET is required (at least ${MIN_RELAY_SECRET} characters)`);
  }
  if (typeof accessPassword !== 'string' || accessPassword.length < MIN_ACCESS_PASSWORD) {
    throw new Error(`ACCESS_PASSWORD is required (at least ${MIN_ACCESS_PASSWORD} characters)`);
  }
  // Changing the password also signs everyone out: the cookie key depends on it.
  const cookieKey = createHmac('sha256', relaySecret).update(`cookie:${accessPassword}`).digest();
  const sign = (text) => createHmac('sha256', cookieKey).update(text).digest('hex');
  const agents = new Map();
  const failures = new Map();

  const makeCookie = () => {
    const expires = Date.now() + SESSION_MS;
    return `${expires}.${sign(String(expires))}`;
  };
  const cookieValid = (value) => {
    const [expires, mac] = String(value ?? '').split('.');
    return Number(expires) > Date.now() && typeof mac === 'string' && safeEqual(mac, sign(expires));
  };
  const bearerValid = (req) => {
    const match = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''));
    return match !== null && safeEqual(match[1], accessPassword);
  };
  const isAuthed = (req) => cookieValid(parseCookies(req.headers.cookie)[COOKIE_NAME]) || bearerValid(req);

  const active = () => [...agents.values()].sort((a, b) => b.priority - a.priority || b.since - a.since)[0];
  const backends = () =>
    [...agents.values()].sort((a, b) => b.priority - a.priority || b.since - a.since).map(({ name, priority, since }) => ({ name, priority, since }));

  function lockedOut(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= LOGIN_MAX_FAILS;
  }
  function recordFailure(ip) {
    const entry = failures.get(ip);
    if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
    else entry.count += 1;
  }

  function forwardHeaders(req) {
    const out = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const lower = name.toLowerCase();
      const value = req.rawHeaders[i + 1];
      if (HOP_HEADERS.has(lower) || lower === 'x-forwarded-for') continue;
      if (lower === 'cookie') {
        const kept = forwardCookie(value);
        if (kept) out[name] = kept;
        continue;
      }
      if (lower === 'authorization' && bearerValid(req)) continue;
      out[name] = out[name] === undefined ? value : `${out[name]}, ${value}`;
    }
    out['X-Forwarded-For'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
    return out;
  }

  function noBackend(res, req) {
    const headers = { 'retry-after': String(RETRY_AFTER_S) };
    if (wantsHtml(req)) {
      page(
        res,
        503,
        'Board offline',
        `<meta http-equiv="refresh" content="${RETRY_AFTER_S}"><h1>Board chưa online</h1><p>Chưa có máy nào nối vào. Trang tự thử lại sau ${RETRY_AFTER_S} giây.</p>`,
        headers,
      );
    } else {
      json(res, 503, { error: 'no_backend' }, headers);
    }
  }

  function proxyHttp(req, res, agent) {
    const upstream = http.request(
      // No `agent` option on purpose: an Agent (even `false`) would ignore createConnection and dial localhost:80.
      { createConnection: () => agent.mux.open(), method: req.method, path: req.url, headers: forwardHeaders(req) },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) json(res, 502, { error: 'backend_unreachable' });
      else res.destroy();
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  function proxyUpgrade(req, socket, head, agent) {
    const stream = agent.mux.open();
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [name, value] of Object.entries(forwardHeaders(req))) lines.push(`${name}: ${value}`);
    // forwardHeaders drops hop headers, but a WebSocket handshake needs them.
    lines.push('Connection: Upgrade', `Upgrade: ${req.headers.upgrade}`, '', '');
    stream.write(lines.join('\r\n'));
    if (head?.length) stream.write(head);
    socket.pipe(stream);
    stream.pipe(socket);
    const end = () => {
      socket.destroy();
      stream.destroy();
    };
    socket.on('error', end);
    stream.on('error', end);
    socket.on('close', end);
    stream.on('close', end);
  }

  async function handleLogin(req, res) {
    const url = new URL(req.url, 'http://relay');
    if (req.method === 'GET') {
      const next = escapeHtml(url.searchParams.get('next') ?? '/');
      page(
        res,
        200,
        'Đăng nhập',
        `<h1>Board</h1><form method="post" action="/login"><input type="hidden" name="next" value="${next}">` +
          '<input type="password" name="password" placeholder="Mật khẩu" autocomplete="current-password" autofocus><button>Vào</button></form>',
      );
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const ip = clientIp(req);
    if (lockedOut(ip)) return json(res, 429, { error: 'too_many_attempts' }, { 'retry-after': String(LOGIN_WINDOW_MS / 1000) });
    let password = '';
    let next = '/';
    const asJson = String(req.headers['content-type'] ?? '').includes('json');
    try {
      const raw = await readBody(req);
      if (asJson) password = String(JSON.parse(raw).password ?? '');
      else {
        const form = new URLSearchParams(raw);
        password = form.get('password') ?? '';
        next = form.get('next') ?? '/';
      }
    } catch (err) {
      return json(res, err.status ?? 400, { error: 'bad_request' });
    }
    if (!password || !safeEqual(password, accessPassword)) {
      recordFailure(ip);
      log(`[relay] login refused from ${ip}`);
      return json(res, 401, { error: 'wrong_password' });
    }
    failures.delete(ip);
    const cookie = `${COOKIE_NAME}=${makeCookie()}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
    if (asJson) return json(res, 200, { ok: true }, { 'set-cookie': cookie });
    // Only same-site paths: "//host" and "/\host" would send the browser to another site.
    const safeNext = /^\/(?![/\\])/.test(next) ? next : '/';
    res.writeHead(303, { location: safeNext, 'set-cookie': cookie });
    res.end();
  }

  function handleRequest(req, res) {
    const url = new URL(req.url, 'http://relay');
    if (url.pathname === '/relay/health') return json(res, 200, { ok: true });
    if (url.pathname === '/login') return void handleLogin(req, res);
    if (url.pathname === '/logout') {
      res.writeHead(303, { location: '/login', 'set-cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
      return void res.end();
    }
    if (!isAuthed(req)) {
      if (wantsHtml(req)) {
        res.writeHead(302, { location: `/login?next=${encodeURIComponent(req.url)}` });
        return void res.end();
      }
      return json(res, 401, { error: 'unauthorized' });
    }
    if (url.pathname === '/relay/status') {
      return json(res, 200, { active: active()?.name ?? null, backends: backends() });
    }
    const agent = active();
    if (!agent) return noBackend(res, req);
    // The board only grants control to a URL that carries its token; hand it over once the user is logged in.
    if (wantsHtml(req) && (url.pathname === '/' || url.pathname === '/index.html') && !url.searchParams.has('token') && agent.boardToken) {
      res.writeHead(302, { location: `/?token=${encodeURIComponent(agent.boardToken)}`, 'cache-control': 'no-store' });
      return void res.end();
    }
    proxyHttp(req, res, agent);
  }

  function refuseUpgrade(socket, status, text) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  const server = http.createServer(handleRequest);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_AGENT_MESSAGE });

  function onAgent(ws) {
    let agent = null;
    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
    });
    const timer = setTimeout(() => ws.terminate(), HELLO_TIMEOUT_MS);
    ws.on('message', (data, isBinary) => {
      if (agent) {
        if (isBinary) agent.mux.receive(Buffer.isBuffer(data) ? data : Buffer.concat(data));
        return;
      }
      clearTimeout(timer);
      let hello;
      try {
        hello = JSON.parse(String(data)).hello;
      } catch {
        return ws.terminate();
      }
      const priority = hello?.priority ?? 0;
      const valid =
        hello &&
        typeof hello.secret === 'string' &&
        safeEqual(hello.secret, relaySecret) &&
        AGENT_NAME.test(String(hello.name)) &&
        Number.isInteger(priority) &&
        priority >= 0 &&
        priority <= MAX_PRIORITY &&
        (hello.boardToken === undefined || (typeof hello.boardToken === 'string' && hello.boardToken.length <= MAX_BOARD_TOKEN));
      if (!valid) return ws.terminate();
      const mux = new Mux((buf) => {
        if (ws.readyState === 1) ws.send(buf);
      });
      agent = { name: hello.name, priority, boardToken: hello.boardToken, since: Date.now(), ws, mux };
      agents.get(agent.name)?.ws.terminate();
      agents.set(agent.name, agent);
      ws.send(JSON.stringify({ ready: true }));
      log(`[relay] board "${agent.name}" online (priority ${priority})`);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!agent) return;
      if (agents.get(agent.name) === agent) agents.delete(agent.name);
      agent.mux.closeAll();
      log(`[relay] board "${agent.name}" offline`);
    });
    ws.on('error', () => {});
  }

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const url = new URL(req.url, 'http://relay');
    if (url.pathname === '/_relay') return wss.handleUpgrade(req, socket, head, onAgent);
    if (!isAuthed(req)) return refuseUpgrade(socket, 401, 'Unauthorized');
    const agent = active();
    if (!agent) return refuseUpgrade(socket, 503, 'Service Unavailable');
    proxyUpgrade(req, socket, head, agent);
  });

  const pinger = setInterval(() => {
    for (const { ws } of agents.values()) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, PING_MS);
  pinger.unref();

  return {
    backends,
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        clearInterval(pinger);
        for (const { ws } of agents.values()) ws.terminate();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
