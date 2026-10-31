#!/usr/bin/env node
// Runs next to a board and keeps it reachable through the relay.
//   RELAY_SECRET=<secret> node relay/tunnel-agent.mjs --relay wss://<node>.bot-keep.xyz/_relay --board-port 3200 [--name local] [--priority 100] [--token-file <path>]
// The relay prefers the highest priority board that is online (local 100, a cloud board 10). The board token is read from
// the token file and sent only to the relay, over TLS, so a logged-in browser can be handed the controlling URL.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startAgent } from './lib/agent.js';

const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.pixel-agents', 'standalone-token');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument "${flag}"`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    out[flag.slice(2)] = value;
  }
  return out;
}

function fail(message) {
  console.error(`[relay-agent] ${message}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  fail(err.message);
}

const secret = process.env.RELAY_SECRET;
if (!secret) fail('RELAY_SECRET is not set (name only; never pass it on the command line)');
if (!args.relay) fail('--relay is required, e.g. wss://comagent6.bot-keep.xyz/_relay');
const boardPort = Number(args['board-port']);
if (!Number.isInteger(boardPort) || boardPort < 1 || boardPort > 65535) fail('--board-port must be 1-65535');
const priority = args.priority === undefined ? 100 : Number(args.priority);
if (!Number.isInteger(priority) || priority < 0 || priority > 1000) fail('--priority must be 0-1000');

const relay = new URL(args.relay);
// Plain ws:// would send the secret in the clear; allow it only for a relay on this machine.
if (relay.protocol !== 'wss:' && !(relay.protocol === 'ws:' && LOOPBACK.has(relay.hostname))) fail('--relay must be wss:// (ws:// only for localhost)');

let boardToken;
try {
  boardToken = readFileSync(args['token-file'] ?? DEFAULT_TOKEN_FILE, 'utf8').trim() || undefined;
} catch {
  console.warn('[relay-agent] no board token file: the relay will show the board read-only');
}

startAgent({ relayUrl: relay.href, secret, boardPort, name: args.name ?? 'local', priority, boardToken, log: console.log });
console.log(`[relay-agent] tunnelling 127.0.0.1:${boardPort} to ${relay.host}`);
