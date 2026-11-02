// A reporter that runs git every minute must never flash a console window on Windows.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GIT_OPTIONS } from './agent.mjs';

test('TC-GITWINDOW-01: every git call made by the reporter is spawned without a visible console window', () => {
  assert.equal(GIT_OPTIONS.windowsHide, true);
});

test('TC-GITWINDOW-02: git calls keep their time limit and ignore stderr', () => {
  assert.equal(GIT_OPTIONS.timeout, 5000);
  assert.deepEqual(GIT_OPTIONS.stdio, ['ignore', 'pipe', 'ignore']);
});
