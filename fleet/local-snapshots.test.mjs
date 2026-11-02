// The local reporter pushes snapshots only when the config asks for it with a real `true`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from './local-agent.mjs';

const text = (extra = {}) => JSON.stringify({ hub: 'https://hub.example', roots: ['/r'], id: 'local-pc', ...extra });

test('TC-LOCALSNAP-01: snapshots are off unless the config says true', () => {
  assert.equal(parseConfig(text()).snapshots, false);
  assert.equal(parseConfig(text({ snapshots: 'true' })).snapshots, false);
  assert.equal(parseConfig(text({ snapshots: 1 })).snapshots, false);
  assert.equal(parseConfig(text({ snapshots: true })).snapshots, true);
});
