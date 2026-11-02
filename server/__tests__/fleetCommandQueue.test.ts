import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { createFleetCommandService, FleetCommandKeyError } from '../src/fleet/commandQueue.js';
import { type FleetCommandContext, handleFleetMessage } from '../src/fleet/handler.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-cmd-'));
  const readKeyPath = join(dir, 'read.pem');
  writeFileSync(readKeyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { dir, readKeyPath, commandKeyPath: join(dir, 'command.pem') };
}

const claimsOf = (init: RequestInit | undefined): Record<string, unknown> => {
  const header = new Headers(init?.headers).get('Authorization') ?? '';
  return JSON.parse(Buffer.from(header.slice('Bearer '.length).split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
};

describe('board command queue', () => {
  it('TC-CMDBOARD-01: the first use creates an owner-only key, prints the PUBLIC key and queues nothing', async () => {
    const { readKeyPath, commandKeyPath } = setup();
    const fetcher = vi.fn<typeof fetch>();
    const log = vi.fn();
    const service = createFleetCommandService({
      loadConfig: async () => ({ hub: 'https://hub.example', keyPath: readKeyPath }),
      commandKeyPath,
      fetch: fetcher,
      log,
    });
    const error = await service.queue({ machine: 'danh', verb: 'snapshot-push', path: '/data/home/repo' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FleetCommandKeyError);
    expect(String((error as Error).message)).toContain('BEGIN PUBLIC KEY');
    expect(String((error as Error).message)).not.toContain('PRIVATE');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('BEGIN PUBLIC KEY'));
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => createPrivateKey(readFileSync(commandKeyPath, 'utf8'))).not.toThrow();
    if (process.platform !== 'win32') expect(statSync(commandKeyPath).mode & 0o777).toBe(0o600);
  });

  it('signs a command-role token with its own key, never the read key, and posts the fixed shape', async () => {
    const { readKeyPath, commandKeyPath } = setup();
    writeFileSync(commandKeyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 'abc', expires_at: 5 }), { status: 200 });
    });
    const service = createFleetCommandService({
      loadConfig: async () => ({ hub: 'https://hub.example', keyPath: readKeyPath }),
      commandKeyPath,
      fetch: fetcher,
      log: vi.fn(),
    });
    await expect(service.queue({ machine: 'danh', verb: 'staging-sync', branch: 'feat/a' })).resolves.toEqual({ id: 'abc' });
    expect(calls[0]?.url).toBe('https://hub.example/v1/commands');
    expect(claimsOf(calls[0]?.init)).toMatchObject({ iss: 'board-command', aud: 'fleet-hub', role: 'command' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ target: 'danh', verb: 'staging-sync', args: { branch: 'feat/a' } });
  });

  it('turns a hub refusal into an error that names the hub reason', async () => {
    const { readKeyPath, commandKeyPath } = setup();
    writeFileSync(commandKeyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const service = createFleetCommandService({
      loadConfig: async () => ({ hub: 'https://hub.example', keyPath: readKeyPath }),
      commandKeyPath,
      fetch: async () => new Response(JSON.stringify({ error: 'branch is protected' }), { status: 400 }),
      log: vi.fn(),
    });
    await expect(service.queue({ machine: 'danh', verb: 'staging-sync', branch: 'main' })).rejects.toThrow(/branch is protected/);
  });

  it('a 401 from the hub means the key is not registered yet: the error carries the public key', async () => {
    const { readKeyPath, commandKeyPath } = setup();
    writeFileSync(commandKeyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const service = createFleetCommandService({
      loadConfig: async () => ({ hub: 'https://hub.example', keyPath: readKeyPath }),
      commandKeyPath,
      fetch: async () => new Response(JSON.stringify({ error: 'unknown issuer' }), { status: 401 }),
      log: vi.fn(),
    });
    const error = await service.queue({ machine: 'danh', verb: 'snapshot-push', path: '/p' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FleetCommandKeyError);
    expect(String((error as Error).message)).toContain('BEGIN PUBLIC KEY');
  });

  it('reads the history with the read key and maps each row to what the board shows', async () => {
    const { readKeyPath, commandKeyPath } = setup();
    const calls: RequestInit[] = [];
    const service = createFleetCommandService({
      loadConfig: async () => ({ hub: 'https://hub.example', keyPath: readKeyPath }),
      commandKeyPath,
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return new Response(
          JSON.stringify({
            now: 9,
            commands: [
              { id: 'a', target: 'danh', verb: 'clean-worktree', args: { path: '/p', branch: 'feat/x' }, state: 'success', created_at: 1, finished_at: 3, result: { status: 'success', detail: 'removed /p' } },
              { id: 'b', target: 'danh1', verb: 'snapshot-push', args: { path: '/q' }, state: 'queued', created_at: 2, expires_at: 99 },
            ],
          }),
          { status: 200 },
        );
      },
      log: vi.fn(),
    });
    const rows = await service.history();
    expect(claimsOf(calls[0])).toMatchObject({ iss: 'board', role: 'read' });
    expect(rows).toEqual([
      { id: 'a', machine: 'danh', verb: 'clean-worktree', path: '/p', branch: 'feat/x', state: 'success', createdAt: 1, finishedAt: 3, detail: 'removed /p' },
      { id: 'b', machine: 'danh1', verb: 'snapshot-push', path: '/q', state: 'queued', createdAt: 2 },
    ]);
  });
});

describe('fleet command messages', () => {
  const queueMessage = { type: 'fleetCommandQueue', requestId: REQUEST_ID, machine: 'danh', verb: 'snapshot-push', path: '/data/home/repo' };
  const historyMessage = { type: 'fleetCommandHistoryRequest', requestId: REQUEST_ID };

  function run(msg: Record<string, unknown>, context: Partial<FleetCommandContext>) {
    const sent: ServerMessage[] = [];
    const handled = handleFleetMessage(msg, (m) => sent.push(m), { ledger: null, privileged: true, ...context });
    return { handled, sent };
  }

  it('TC-CMDBOARD-02: an unprivileged socket is refused and the service is never touched', () => {
    const queue = vi.fn();
    const history = vi.fn();
    for (const msg of [queueMessage, historyMessage]) {
      const { handled, sent } = run(msg, { privileged: false, commands: { queue, history } });
      expect(handled).toBe(true);
      expect(sent).toEqual([expect.objectContaining({ type: 'fleetCommandResult', ok: false, code: 'forbidden' })]);
    }
    expect(queue).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('queues through the service and answers success', async () => {
    const queue = vi.fn(async () => ({ id: 'abc' }));
    const { sent } = run(queueMessage, { commands: { queue, history: async () => [] } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(queue).toHaveBeenCalledWith({ machine: 'danh', verb: 'snapshot-push', path: '/data/home/repo' });
    expect(sent[0]).toEqual({ type: 'fleetCommandResult', requestId: REQUEST_ID, ok: true, code: 'success' });
  });

  it('refuses a malformed command before it reaches the service', async () => {
    const queue = vi.fn();
    const bad = [
      { ...queueMessage, verb: 'rm-rf' },
      { ...queueMessage, machine: 'Danh; rm' },
      { ...queueMessage, path: 7 },
      { ...queueMessage, branch: 'a b' },
    ];
    for (const msg of bad) {
      const { sent } = run(msg, { commands: { queue, history: async () => [] } });
      expect(sent).toEqual([expect.objectContaining({ type: 'fleetCommandResult', ok: false, code: 'failed' })]);
    }
    expect(queue).not.toHaveBeenCalled();
  });

  it('shows the hub reason or the key error when the service fails', async () => {
    const { sent } = run(queueMessage, { commands: { queue: async () => { throw new FleetCommandKeyError('Đăng ký khoá: BEGIN PUBLIC KEY'); }, history: async () => [] } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ ok: false, code: 'failed', reason: expect.stringContaining('BEGIN PUBLIC KEY') });
  });

  it('answers a history request with the rows', async () => {
    const rows = [{ id: 'a', machine: 'danh', verb: 'snapshot-push' as const, state: 'queued' as const, createdAt: 1 }];
    const { sent } = run(historyMessage, { commands: { queue: vi.fn(), history: async () => rows } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: 'fleetCommandHistory', requestId: REQUEST_ID, commands: rows });
  });
});
