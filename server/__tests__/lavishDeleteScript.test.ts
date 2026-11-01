import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LAVISH_DELETE_SCRIPT } from '../src/fleet/lavishDelete.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = 'b702b4f8df032645';
const posix = (path: string) => path.split('\\').join('/');

/**
 * Runs the real delete script under bash against a fake HOME holding a Lavish state file and a fake `lavish-axi`
 * on PATH that logs its calls. `file` is the page the state file maps KEY to, relative to HOME.
 */
function runDelete(key: string, file: string | null, relative = file) {
  const home = mkdtempSync(join(tmpdir(), 'lavish-home-'));
  dirs.push(home);
  const homePosix = posix(home);
  const absolute = file === null ? null : `${homePosix}/${file}`;
  mkdirSync(join(home, '.lavish-axi'), { recursive: true });
  writeFileSync(join(home, '.lavish-axi', 'state.json'), JSON.stringify({ sessions: absolute === null ? {} : { [KEY]: { file: absolute, status: 'open' } } }));
  if (absolute !== null && relative !== null && !file?.includes('..')) {
    mkdirSync(join(home, ...relative.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(home, ...relative.split('/')), '<html></html>');
  }
  const log = join(home, 'lavish-calls.log');
  const shim = join(home, 'lavish-axi');
  writeFileSync(shim, ['#!/bin/bash', `echo "$@" >> "${posix(log)}"`, 'exit 0', ''].join('\n'));
  chmodSync(shim, 0o755);
  const result = spawnSync('bash', ['-s', '--', key], {
    input: LAVISH_DELETE_SCRIPT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homePosix, PATH: `${homePosix}:${process.env.PATH ?? ''}` },
  });
  return {
    code: result.status,
    out: result.stdout.trim(),
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
    fileStillThere: absolute !== null && existsSync(join(home, ...(relative ?? '').split('/'))),
    absolute,
  };
}

describe('LAVISH_DELETE_SCRIPT', () => {
  it('ends the session and removes the page of a known key', () => {
    const { code, out, calls, fileStillThere, absolute } = runDelete(KEY, 'wt/job/.lavish/plan.html');

    expect(code).toBe(0);
    expect(out).toMatch(new RegExp(`^OK ${KEY}`));
    expect(calls).toContain(`end ${absolute}`);
    expect(fileStillThere).toBe(false);
  });

  it('treats a key Lavish no longer knows as already gone and touches nothing', () => {
    const { code, out, calls } = runDelete(KEY, null);

    expect(code).toBe(0);
    expect(out).toMatch(new RegExp(`^OK ${KEY}`));
    expect(calls).toBe('');
  });

  it('refuses a page that does not live in a .lavish directory', () => {
    const { code, out, calls, fileStillThere } = runDelete(KEY, 'wt/job/src/plan.html');

    expect(code).toBe(3);
    expect(out).toMatch(/\.lavish/);
    expect(calls).toBe('');
    expect(fileStillThere).toBe(true);
  });

  it('refuses a path that climbs out with ..', () => {
    const { code, calls } = runDelete(KEY, 'wt/job/.lavish/../../secret.html');

    expect(code).toBe(3);
    expect(calls).toBe('');
  });
});
