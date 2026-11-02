// fleet-hub: cloud machines POST signed reports; the board GETs the fleet. Read-only view, no code content.
// Env: FLEET_KEYS (path to keys.json: { agent_id: { pub: PEM, role: "report"|"read" } }),
//      FLEET_STATE (path to persisted latest reports), PORT (default 18430), HOST (default 127.0.0.1).
// Roles: report (a machine), read (the board's view), command (only the board's second key may queue commands).
// Commands ride the report round trip: the reply carries them, the next report carries the results.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { commandError } from './commandSpec.mjs';
import { verifyJwt } from './jwt.mjs';

const MAX_BODY = 64 * 1024;
const RATE_PER_MIN = 60;

const GUARD_KINDS = new Set(['unpushed', 'dirty', 'stash', 'op', 'prunable', 'detached']);
const GUARD_OPS = new Set(['rebase', 'merge', 'cherry-pick', 'bisect']);
const MAX_GUARD_BYTES = 16 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGuard(value) {
  if (!isRecord(value) || typeof value.machine !== 'string' || typeof value.scannedAt !== 'string'
      || !Number.isFinite(Date.parse(value.scannedAt)) || !Array.isArray(value.repos) || !Array.isArray(value.risks)) return null;
  const boundedText = (text, max) => text.slice(0, max);
  let worktreesRemaining = 100;
  const repos = [];
  for (const repo of value.repos.slice(0, 20)) {
    if (!isRecord(repo) || typeof repo.repo !== 'string' || !Array.isArray(repo.worktrees)) return null;
    const worktrees = [];
    for (const item of repo.worktrees.slice(0, worktreesRemaining)) {
      if (
        !isRecord(item) ||
        typeof item.path !== 'string' ||
        !(item.branch === null || typeof item.branch === 'string') ||
        typeof item.head !== 'string' ||
        !Number.isFinite(item.unpushed) ||
        item.unpushed < 0 ||
        !Array.isArray(item.unpushedSubjects) ||
        item.unpushedSubjects.length > 5 ||
        !item.unpushedSubjects.every((subject) => typeof subject === 'string') ||
        typeof item.backedUp !== 'boolean' ||
        !Number.isFinite(item.dirty) ||
        item.dirty < 0 ||
        !(item.ignored === undefined || (Number.isFinite(item.ignored) && item.ignored >= 0)) ||
        !(item.dirtyKnown === undefined || typeof item.dirtyKnown === 'boolean') ||
        !(
          item.dirtyOldestMinutes === null ||
          (Number.isFinite(item.dirtyOldestMinutes) && item.dirtyOldestMinutes >= 0)
        ) ||
        !(
          item.idleMinutes === undefined ||
          (Number.isFinite(item.idleMinutes) && item.idleMinutes >= 0)
        ) ||
        !(item.op === null || GUARD_OPS.has(item.op)) ||
        typeof item.mergedToMain !== 'boolean' ||
        !Number.isFinite(item.idleDays) ||
        item.idleDays < 0 ||
        typeof item.prunable !== 'boolean'
      )
        return null;
      worktrees.push({
        path: boundedText(item.path, 500),
        branch: item.branch === null ? null : boundedText(item.branch, 256),
        head: boundedText(item.head, 64),
        unpushed: item.unpushed,
        unpushedSubjects: item.unpushedSubjects.slice(0, 5).map((subject) => boundedText(subject, 200)),
        backedUp: item.backedUp,
        dirty: item.dirty,
        ...(Number.isFinite(item.ignored) ? { ignored: item.ignored } : {}),
        ...(typeof item.dirtyKnown === 'boolean' ? { dirtyKnown: item.dirtyKnown } : {}),
        dirtyOldestMinutes: item.dirtyOldestMinutes,
        op: item.op,
        mergedToMain: item.mergedToMain,
        idleDays: item.idleDays,
        ...(Number.isFinite(item.idleMinutes) ? { idleMinutes: item.idleMinutes } : {}),
        prunable: item.prunable,
      });
    }
    worktreesRemaining -= worktrees.length;
    repos.push({ repo: boundedText(repo.repo, 500), worktrees });
  }
  const risks = [];
  for (const risk of value.risks.slice(0, 100)) {
    if (!isRecord(risk) || !['red', 'yellow'].includes(risk.level) || !GUARD_KINDS.has(risk.kind)
        || typeof risk.repo !== 'string' || typeof risk.path !== 'string' || typeof risk.detail !== 'string') return null;
    risks.push({
      level: risk.level,
      kind: risk.kind,
      repo: boundedText(risk.repo, 500),
      path: boundedText(risk.path, 500),
      detail: boundedText(risk.detail, 300),
    });
  }
  const guard = { machine: boundedText(value.machine, 100), scannedAt: boundedText(value.scannedAt, 40), repos, risks };
  const size = () => Buffer.byteLength(JSON.stringify(guard));
  while (size() > MAX_GUARD_BYTES) {
    if (guard.risks.length) guard.risks.pop();
    else {
      const repo = guard.repos.at(-1);
      if (repo?.worktrees.length) repo.worktrees.pop();
      else if (guard.repos.length) guard.repos.pop();
      else break;
    }
  }
  return guard;
}

const VERDICT_STATUSES = new Set(['conflict', 'auto', 'incomplete']);
const MAX_VERDICTS = 200;
const MAX_RANGES = 20;
const ONLINE_WITHIN_MS = 10 * 60 * 1000;
const LOCAL_REPORTER_PREFIX = 'local-';

const COMMAND_TTL_MS = 10 * 60 * 1000;
const DELIVERED_TTL_MS = 15 * 60 * 1000;
const MAX_COMMANDS = 500;
const MAX_QUEUED_PER_MACHINE = 20;
const MAX_RESULTS = 20;
const MAX_DETAIL = 500;
const RESULT_STATUSES = new Set(['success', 'failed', 'refused']);
const TARGET_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const isLine = (n) => Number.isInteger(n) && n >= 1;

/** Verdicts a judge machine posts (fleet/judge.mjs). Bad entries are dropped one by one, never the whole report. */
function normalizeVerdicts(value) {
  if (!Array.isArray(value)) return [];
  const verdicts = [];
  for (const item of value) {
    if (verdicts.length >= MAX_VERDICTS) break;
    if (!isRecord(item) || !VERDICT_STATUSES.has(item.status) || typeof item.file !== 'string') continue;
    if (![item.repo, item.a, item.b].every((text) => typeof text === 'string' && text !== '')) continue;
    const ranges = item.ranges;
    if (ranges !== undefined && !(Array.isArray(ranges) && ranges.every((pair) => Array.isArray(pair) && pair.length === 2 && isLine(pair[0]) && isLine(pair[1])))) continue;
    verdicts.push({
      repo: item.repo.slice(0, 200), a: item.a.slice(0, 200), b: item.b.slice(0, 200), file: item.file.slice(0, 500), status: item.status,
      ...(ranges === undefined ? {} : { ranges: ranges.slice(0, MAX_RANGES) }),
    });
  }
  return verdicts;
}

/**
 * Repositories `agentId` must judge: reported by at least two machines, and this machine is the lowest-id online cloud
 * machine that holds them. Local reporters (`local-…`) never judge. With no cloud machine online nobody is chosen.
 */
function reposToJudge(reports, agentId, nowMs) {
  if (agentId.startsWith(LOCAL_REPORTER_PREFIX)) return [];
  const holders = new Map();
  for (const report of Object.values(reports)) {
    for (const row of report.repos ?? []) {
      if (typeof row?.github_repo !== 'string' || row.github_repo === '') continue;
      const entry = holders.get(row.github_repo) ?? { machines: new Set(), online: new Set() };
      entry.machines.add(report.agent_id);
      if (nowMs - report.received_at <= ONLINE_WITHIN_MS && !report.agent_id.startsWith(LOCAL_REPORTER_PREFIX)) entry.online.add(report.agent_id);
      holders.set(row.github_repo, entry);
    }
  }
  return [...holders]
    .filter(([, entry]) => entry.machines.size >= 2 && [...entry.online].sort()[0] === agentId)
    .map(([repo]) => repo)
    .sort()
    .slice(0, 20);
}

export function createHub({ keysPath, statePath, now = () => Date.now(), startedAt = now() }) {
  const seenJti = new Map();
  const hits = new Map();
  const reports = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const loadKeys = () => JSON.parse(readFileSync(keysPath, 'utf8'));

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const auth = (req, role) => {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new Error('missing token');
    return verifyJwt(header.slice(7), { keys: loadKeys(), audience: 'fleet-hub', role, seenJti, now: now(), issuedAfter: startedAt });
  };
  const limited = (id) => {
    const minute = Math.floor(now() / 60000);
    const entry = hits.get(id);
    const count = entry && entry.minute === minute ? entry.count + 1 : 1;
    hits.set(id, { minute, count });
    return count > RATE_PER_MIN;
  };
  const persist = () => {
    if (!statePath) return;
    writeFileSync(`${statePath}.tmp`, JSON.stringify(reports), { mode: 0o600 });
    renameSync(`${statePath}.tmp`, statePath);
  };

  const commandsPath = statePath ? `${statePath}.commands.json` : null;
  const auditPath = statePath ? `${statePath}.audit.jsonl` : null;
  const commands = commandsPath && existsSync(commandsPath) ? JSON.parse(readFileSync(commandsPath, 'utf8')) : [];
  let commandsDirty = false;
  // Every state change is one append-only audit line: who, what, for which machine, when.
  const setState = (cmd, state, by, extra = {}) => {
    Object.assign(cmd, extra, { state });
    commandsDirty = true;
    if (auditPath) appendFileSync(auditPath, `${JSON.stringify({ at: now(), id: cmd.id, state, by, target: cmd.target, verb: cmd.verb })}\n`, { mode: 0o600 });
  };
  const flushCommands = () => {
    if (!commandsPath || !commandsDirty) return;
    commandsDirty = false;
    if (commands.length > MAX_COMMANDS) commands.splice(0, commands.length - MAX_COMMANDS);
    writeFileSync(`${commandsPath}.tmp`, JSON.stringify(commands), { mode: 0o600 });
    renameSync(`${commandsPath}.tmp`, commandsPath);
  };
  const expireCommands = () => {
    const at = now();
    for (const cmd of commands) {
      if (cmd.state === 'queued' && cmd.expires_at <= at) setState(cmd, 'expired', 'hub', { finished_at: at });
      else if (cmd.state === 'delivered' && cmd.delivered_at + DELIVERED_TTL_MS <= at) setState(cmd, 'expired', 'hub', { finished_at: at });
    }
  };
  // A result counts once, and only from the machine the command was delivered to.
  const applyResults = (agentId, results) => {
    if (!Array.isArray(results)) return;
    for (const item of results.slice(0, MAX_RESULTS)) {
      if (!isRecord(item) || !RESULT_STATUSES.has(item.status) || typeof item.id !== 'string') continue;
      const cmd = commands.find((c) => c.id === item.id);
      if (!cmd || cmd.target !== agentId || cmd.state !== 'delivered') continue;
      const detail = typeof item.detail === 'string' ? item.detail.slice(0, MAX_DETAIL) : '';
      setState(cmd, item.status, agentId, { finished_at: now(), result: { status: item.status, detail } });
    }
  };
  // One command at a time per machine: the oldest queued one goes out only when nothing is awaiting a result.
  const deliverNext = (agentId) => {
    if (commands.some((c) => c.target === agentId && c.state === 'delivered')) return [];
    const cmd = commands.find((c) => c.target === agentId && c.state === 'queued');
    if (!cmd) return [];
    setState(cmd, 'delivered', agentId, { delivered_at: now() });
    return [{ id: cmd.id, verb: cmd.verb, args: cmd.args, expires_at: cmd.expires_at }];
  };
  const readBody = (req, res, handle) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(res, 400, { error: 'json' }); }
      handle(body);
    });
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://hub');
    if (req.method === 'GET' && url.pathname === '/v1/fleet') {
      try { auth(req, 'read'); } catch (e) { return send(res, 401, { error: e.message }); }
      return send(res, 200, { now: now(), machines: Object.values(reports) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/commands') {
      try { auth(req, 'read'); } catch (e) { return send(res, 401, { error: e.message }); }
      expireCommands();
      flushCommands();
      return send(res, 200, { now: now(), commands: commands.slice(-100).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/v1/commands') {
      let claims;
      try { claims = auth(req, 'command'); } catch (e) { return send(res, 401, { error: e.message }); }
      if (limited(claims.iss)) return send(res, 429, { error: 'rate' });
      return readBody(req, res, (body) => {
        const { target, verb, args } = isRecord(body) ? body : {};
        const reason = typeof target !== 'string' || !TARGET_PATTERN.test(target) ? 'bad target'
          : !reports[target] ? 'unknown machine'
          : commandError(verb, args);
        if (reason) return send(res, 400, { error: reason });
        expireCommands();
        if (commands.filter((c) => c.target === target && c.state === 'queued').length >= MAX_QUEUED_PER_MACHINE) {
          flushCommands();
          return send(res, 429, { error: 'queue full' });
        }
        const created = now();
        const cmd = { id: randomUUID(), target, verb, args, created_at: created, expires_at: created + COMMAND_TTL_MS };
        commands.push(cmd);
        setState(cmd, 'queued', claims.iss);
        flushCommands();
        send(res, 200, { id: cmd.id, expires_at: cmd.expires_at });
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/report') {
      let claims;
      try { claims = auth(req, 'report'); } catch (e) { return send(res, 401, { error: e.message }); }
      if (limited(claims.iss)) return send(res, 429, { error: 'rate' });
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (size > MAX_BODY) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(res, 400, { error: 'json' }); }
        if (body.agent_id !== claims.iss) return send(res, 403, { error: 'agent_id mismatch' });
        reports[claims.iss] = {
          agent_id: claims.iss,
          received_at: now(),
          disk_free_gb: typeof body.disk_free_gb === 'number' ? body.disk_free_gb : null,
          skill_version: typeof body.skill_version === 'string' && /^[0-9a-f]{12}$/.test(body.skill_version) ? body.skill_version : null,
          sessions: Array.isArray(body.sessions) ? body.sessions.slice(0, 50) : [],
          tmux: Array.isArray(body.tmux) ? body.tmux.slice(0, 30) : [],
          lavish: Array.isArray(body.lavish) ? body.lavish.slice(0, 20) : [],
          viec: Array.isArray(body.viec) ? body.viec.slice(0, 30) : [],
          repos: Array.isArray(body.repos) ? body.repos.slice(0, 20) : [],
          guard: normalizeGuard(body.guard),
          verdicts: normalizeVerdicts(body.verdicts),
        };
        persist();
        applyResults(claims.iss, body.results);
        expireCommands();
        const due = deliverNext(claims.iss);
        flushCommands();
        send(res, 200, { ok: true, judge: reposToJudge(reports, claims.iss, now()), commands: due });
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createHub({ keysPath: process.env.FLEET_KEYS, statePath: process.env.FLEET_STATE });
  server.listen(Number(process.env.PORT ?? 18430), process.env.HOST ?? '127.0.0.1', () =>
    console.log(`fleet-hub listening ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 18430}`));
}
