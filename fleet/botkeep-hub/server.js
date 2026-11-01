// Entry point of the fleet hub on a Botkeep node. The platform runs `npm install` and `npm start`, then puts HTTPS in front.
// Env (all optional): PORT or SERVER_PORT (default 18430), HOST (default 0.0.0.0: the platform's proxy reaches it),
// FLEET_DATA (default ./fleet-data), FLEET_KEYS, FLEET_STATE.
// keys.json holds PUBLIC keys only: { "<agent_id>": { "pub": "<PEM>", "role": "report" | "read" } }. The hub re-reads it on
// every request, so adding or revoking a machine never needs a restart. state.json holds the latest report of each machine.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHub } from './hub.mjs';

const data = process.env.FLEET_DATA ?? join(dirname(fileURLToPath(import.meta.url)), 'fleet-data');
mkdirSync(data, { recursive: true, mode: 0o700 });
const keysPath = process.env.FLEET_KEYS ?? join(data, 'keys.json');
if (!existsSync(keysPath)) writeFileSync(keysPath, '{}', { mode: 0o600 });

const hub = createHub({ keysPath, statePath: process.env.FLEET_STATE ?? join(data, 'state.json') });
const host = process.env.HOST ?? '0.0.0.0';
hub.listen(Number(process.env.PORT || process.env.SERVER_PORT || 18430), host, () => {
  console.log(`[fleet-hub] listening ${host}:${hub.address().port}`);
});
