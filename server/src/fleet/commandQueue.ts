import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

import type { FleetCommandRow, FleetCommandState, FleetCommandVerb } from '../../../core/src/messages.js';
import { type FleetConfig, readFleetConfig } from './config.js';
import {
  FLEET_COMMAND_ISSUER,
  FLEET_COMMAND_KEY_PATH_SEGMENTS,
  FLEET_FETCH_TIMEOUT_MS,
} from './constants.js';
import { FleetUnavailableError, signHubToken } from './hubClient.js';

export interface FleetCommandInput {
  readonly machine: string;
  readonly verb: FleetCommandVerb;
  readonly path?: string;
  readonly branch?: string;
}

export interface FleetCommandService {
  queue(input: FleetCommandInput): Promise<{ readonly id: string }>;
  history(): Promise<FleetCommandRow[]>;
}

export interface FleetCommandServiceOptions {
  readonly configPath?: string;
  readonly loadConfig?: () => Promise<FleetConfig | null>;
  readonly commandKeyPath?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/** The board's command key is not known to the hub yet; the message carries the PUBLIC key to register. */
export class FleetCommandKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FleetCommandKeyError';
  }
}

const STATES: ReadonlySet<string> = new Set<FleetCommandState>(['queued', 'delivered', 'success', 'failed', 'refused', 'expired']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const publicKeyOf = (privateKeyPem: string): string =>
  createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();

const registerMessage = (publicKey: string): string =>
  `Khoá lệnh của board chưa được đăng ký trên hub. Thêm khoá công khai này vào keys.json của hub với id "${FLEET_COMMAND_ISSUER}" và role "command", rồi thử lại:\n${publicKey}`;

function toRow(value: unknown): FleetCommandRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.target !== 'string' || typeof value.verb !== 'string') return null;
  if (typeof value.state !== 'string' || !STATES.has(value.state) || typeof value.created_at !== 'number') return null;
  const args = isRecord(value.args) ? value.args : {};
  const result = isRecord(value.result) ? value.result : {};
  return {
    id: value.id,
    machine: value.target,
    verb: value.verb as FleetCommandVerb,
    ...(typeof args.path === 'string' ? { path: args.path } : {}),
    ...(typeof args.branch === 'string' ? { branch: args.branch } : {}),
    state: value.state as FleetCommandState,
    createdAt: value.created_at,
    ...(typeof value.finished_at === 'number' ? { finishedAt: value.finished_at } : {}),
    ...(typeof result.detail === 'string' && result.detail !== '' ? { detail: result.detail } : {}),
  };
}

export function createFleetCommandService(options: FleetCommandServiceOptions = {}): FleetCommandService {
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const log = options.log ?? ((line: string) => console.log(`[Pixel Agents] ${line}`));
  const loadConfig = options.loadConfig ?? (() => readFleetConfig(options.configPath));

  /** Creates the key once, owner-only and never replaced; `created` tells the caller it cannot be registered yet. */
  async function ensureCommandKey(): Promise<{ readonly pem: string; readonly created: boolean }> {
    // Resolved on use, not at import: the default service is built while the module loads.
    const commandKeyPath = options.commandKeyPath ?? path.join(homedir(), ...FLEET_COMMAND_KEY_PATH_SEGMENTS);
    try {
      return { pem: await readFile(commandKeyPath, 'utf8'), created: false };
    } catch {
      // Not there yet: fall through and create it.
    }
    const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await mkdir(path.dirname(commandKeyPath), { recursive: true });
    try {
      await writeFile(commandKeyPath, pem, { mode: 0o600, flag: 'wx' });
      return { pem, created: true };
    } catch {
      // Another request created it first: use theirs, never overwrite.
      return { pem: await readFile(commandKeyPath, 'utf8'), created: false };
    }
  }

  async function queue(input: FleetCommandInput): Promise<{ readonly id: string }> {
    const config = await loadConfig();
    if (config === null) throw new FleetUnavailableError();
    const key = await ensureCommandKey();
    if (key.created) {
      const message = registerMessage(publicKeyOf(key.pem));
      log(message);
      throw new FleetCommandKeyError(message);
    }
    const args: Record<string, string> = {};
    if (input.path !== undefined) args.path = input.path;
    if (input.branch !== undefined) args.branch = input.branch;
    const response = await fetcher(new URL('/v1/commands', config.hub), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signHubToken(key.pem, now(), FLEET_COMMAND_ISSUER, 'command')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ target: input.machine, verb: input.verb, args }),
      signal: AbortSignal.timeout(FLEET_FETCH_TIMEOUT_MS),
    });
    if (response.status === 401) throw new FleetCommandKeyError(registerMessage(publicKeyOf(key.pem)));
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new Error(`Hub từ chối lệnh: ${reason}`);
    }
    if (!isRecord(body) || typeof body.id !== 'string') throw new Error('Hub trả về phản hồi lệnh không hợp lệ.');
    return { id: body.id };
  }

  async function history(): Promise<FleetCommandRow[]> {
    const config = await loadConfig();
    if (config === null) throw new FleetUnavailableError();
    const response = await fetcher(new URL('/v1/commands', config.hub), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${signHubToken(await readFile(config.keyPath, 'utf8'), now(), 'board', 'read')}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FLEET_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Fleet hub responded with ${response.status}.`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.commands)) throw new Error('Fleet hub returned an invalid response.');
    return body.commands.map(toRow).filter((row): row is FleetCommandRow => row !== null);
  }

  return { queue, history };
}
