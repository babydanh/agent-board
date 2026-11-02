import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { AgentEngine } from '../../../core/src/agentEngines.js';
import type { GitGuardReport } from '../../../core/src/messages.js';
import { type FleetConfig, readFleetConfig } from './config.js';
import { FLEET_CACHE_MS, FLEET_FETCH_TIMEOUT_MS } from './constants.js';

export type FleetHubEngine = AgentEngine;

export interface FleetHubSession {
  readonly engine: FleetHubEngine;
  readonly pid: number;
  readonly cwd: string;
  readonly branch: string;
}

export interface FleetHubRepo {
  readonly path: string;
  /** Main checkout folder name, reported for worktrees too; older agents omit it. */
  readonly repo?: string;
  /** Safe HOST/OWNER/REPO parsed from origin; the raw remote URL is never reported. */
  readonly github_repo?: string;
  readonly branch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly dirty_files: readonly string[];
  readonly merged?: boolean;
  readonly staged?: boolean;
  readonly head?: string;
  readonly origin_main?: string;
  /** Changed line ranges per file, in merge-base-with-main coordinates (approximate). */
  readonly changes?: readonly { readonly path: string; readonly ranges: readonly (readonly [number, number])[] }[];
}

export interface FleetHubTmux {
  readonly name: string;
  readonly cwd?: string;
  readonly attached: boolean;
  readonly idle_seconds: number;
  readonly command?: string;
  readonly branch?: string;
  readonly engine?: FleetHubEngine;
}
export interface FleetHubTask {
  readonly slug: string;
  readonly status: 'dang-lam' | 'xong';
  readonly branch: string;
}

/** One exact pair result from the judge machine (fleet/judge.mjs). `file` is empty when the pair could not be checked. */
export interface FleetHubVerdict {
  /** HOST/OWNER/REPO of the repository the two lanes belong to. */
  readonly repo: string;
  /** Lane names `<machine>/<branch>`. */
  readonly a: string;
  readonly b: string;
  readonly file: string;
  readonly status: 'conflict' | 'auto' | 'incomplete';
  readonly ranges?: readonly (readonly [number, number])[];
}

export interface FleetHubMachine {
  readonly agent_id: string;
  readonly received_at: number;
  readonly sessions: readonly FleetHubSession[];
  readonly repos: readonly FleetHubRepo[];
  readonly disk_free_gb?: number | null;
  readonly skill_version?: string | null;
  readonly tmux?: readonly FleetHubTmux[];
  readonly lavish?: readonly { readonly key: string; readonly file: string }[];
  readonly viec?: readonly FleetHubTask[];
  readonly guard?: GitGuardReport | null;
  readonly verdicts?: readonly FleetHubVerdict[];
}

export interface FleetHubResponse {
  readonly now: number;
  readonly machines: readonly FleetHubMachine[];
}

export interface FleetHubClient {
  fetchFleet(): Promise<FleetHubResponse>;
}

export interface FleetHubClientOptions {
  readonly configPath?: string;
  readonly loadConfig?: () => Promise<FleetConfig | null>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export class FleetUnavailableError extends Error {
  constructor() {
    super('Fleet is not configured.');
    this.name = 'FleetUnavailableError';
  }
}

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');

/** Signs a short-lived read token locally. The private key and token never leave this module. */
function signReadToken(privateKeyPem: string, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'board',
      aud: 'fleet-hub',
      role: 'read',
      iat: issuedAt,
      exp: issuedAt + 300,
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const signature = sign(
    null,
    Buffer.from(`${JWT_HEADER}.${payload}`),
    createPrivateKey(privateKeyPem),
  ).toString('base64url');
  return `${JWT_HEADER}.${payload}.${signature}`;
}

export function createFleetHubClient(options: FleetHubClientOptions = {}): FleetHubClient {
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const loadConfig = options.loadConfig ?? (() => readFleetConfig(options.configPath));
  let cached: { readonly at: number; readonly response: FleetHubResponse } | null = null;
  let inFlight: Promise<FleetHubResponse> | null = null;

  async function fetchFleet(): Promise<FleetHubResponse> {
    const config = await loadConfig();
    if (config === null) throw new FleetUnavailableError();
    if (cached !== null && now() - cached.at < FLEET_CACHE_MS) return cached.response;
    if (inFlight !== null) return inFlight;

    inFlight = fetchFromHub(config).then((response) => {
      cached = { at: now(), response };
      return response;
    });
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function fetchFromHub(config: FleetConfig): Promise<FleetHubResponse> {
    const privateKeyPem = await readFile(config.keyPath, 'utf8');
    const token = signReadToken(privateKeyPem, now());
    const response = await fetcher(new URL('/v1/fleet', config.hub), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FLEET_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Fleet hub responded with ${response.status}.`);
    const payload: unknown = await response.json();
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      !('now' in payload) ||
      typeof payload.now !== 'number' ||
      !('machines' in payload) ||
      !Array.isArray(payload.machines)
    ) {
      throw new Error('Fleet hub returned an invalid response.');
    }
    return payload as FleetHubResponse;
  }

  return { fetchFleet };
}

