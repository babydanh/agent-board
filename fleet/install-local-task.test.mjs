// Tests for the local reporter installer: the plan is pure, install/remove touch only the paths the plan names.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AGENT_FILES, install, LAUNCHER_NAME, planInstall, remove } from './install-local-task.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const base = { srcDir: HERE, home: 'C:\\Users\\a', appData: 'C:\\Users\\a\\AppData\\Roaming', node: 'C:\\Program Files\\nodejs\\node.exe' };

test('TC-LOCALTASK-01: the plan puts the agent in one folder under the home and the launcher in Startup', () => {
  const plan = planInstall(base);
  assert.ok(plan.destDir.endsWith(join('.pixel-agents', 'fleet-agent')));
  assert.ok(plan.launcherPath.endsWith(join('Startup', LAUNCHER_NAME)));
  assert.deepEqual(plan.files, AGENT_FILES);
});

test('TC-LOCALTASK-02: the launcher runs the loop hidden and does not wait for it', () => {
  const { launcher, agent } = planInstall(base);
  assert.ok(launcher.includes('--loop'));
  assert.ok(launcher.includes(`"${agent}"`.replace(/"/g, '""')));
  assert.match(launcher, /, 0, False\s*$/);
});

test('TC-LOCALTASK-03: a path holding a double quote is refused, so it cannot break out of the launcher line', () => {
  assert.throws(() => planInstall({ ...base, node: 'C:\\x"y\\node.exe' }), /double quote/);
  assert.throws(() => planInstall({ ...base, home: 'C:\\Users\\a"b' }), /double quote/);
});

test('TC-LOCALTASK-04: install copies the agent files and writes the launcher; remove deletes both and is repeatable', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-task-'));
  try {
    const home = join(root, 'home');
    const appData = join(root, 'appdata');
    const plan = planInstall({ ...base, home, appData });
    install(plan);
    for (const name of AGENT_FILES) assert.ok(existsSync(join(plan.destDir, name)), name);
    assert.equal(readFileSync(plan.launcherPath, 'utf8'), plan.launcher);
    remove(plan);
    assert.equal(existsSync(plan.destDir), false);
    assert.equal(existsSync(plan.launcherPath), false);
    assert.doesNotThrow(() => remove(plan));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-LOCALTASK-05: remove never touches the key or the config that sit next to the agent folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-task-'));
  try {
    const home = join(root, 'home');
    const plan = planInstall({ ...base, home, appData: join(root, 'appdata') });
    install(plan);
    const keep = [join(home, '.pixel-agents', 'fleet-local.json'), join(home, '.pixel-agents', 'fleet-local-key.pem')];
    for (const file of keep) writeFileSync(file, 'x');
    remove(plan);
    for (const file of keep) assert.ok(existsSync(file), file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TC-LOCALTASK-06: remove refuses a destination folder that is not the agent folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-task-'));
  try {
    const plan = planInstall({ ...base, home: join(root, 'home'), appData: join(root, 'appdata') });
    mkdirSync(join(root, 'precious'));
    assert.throws(() => remove({ ...plan, destDir: join(root, 'precious') }), /fleet-agent/);
    assert.ok(existsSync(join(root, 'precious')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
