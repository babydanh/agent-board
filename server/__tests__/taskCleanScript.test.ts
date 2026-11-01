import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TASK_CLEAN_SCRIPT } from '../src/fleet/taskClean.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the real clean script under bash with a fake `tmux` on PATH that reports the given sessions and logs every call. */
function runClean(slug: string, sessions: string[]) {
  const home = mkdtempSync(join(tmpdir(), 'clean-home-'));
  dirs.push(home);
  const log = join(home, 'tmux-calls.log');
  const shim = join(home, 'tmux');
  writeFileSync(
    shim,
    [
      '#!/bin/bash',
      `echo "$@" >> "${log.split('\\').join('/')}"`,
      'if [ "$1" = has-session ]; then',
      '  name="${3#=}"',
      `  case " ${sessions.join(' ')} " in *" $name "*) exit 0 ;; esac`,
      '  exit 1',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(shim, 0o755);
  const result = spawnSync('bash', ['-s', '--', slug], {
    input: TASK_CLEAN_SCRIPT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home.split('\\').join('/'), PATH: `${home.split('\\').join('/')}:${process.env.PATH ?? ''}` },
  });
  let calls = '';
  try {
    calls = readFileSync(log, 'utf8');
  } catch {
    calls = '';
  }
  return { code: result.status, out: result.stdout.trim(), calls };
}

describe('TASK_CLEAN_SCRIPT for a session cloud-giao did not create', () => {
  it('closes only the tmux session (it owns no worktree to remove) and says so', () => {
    const { code, out, calls } = runClean('auto3d-ci', ['auto3d-ci']);

    expect(code).toBe(0);
    expect(out).toMatch(/^OK auto3d-ci/);
    expect(calls).toContain('kill-session -t =auto3d-ci');
  });

  it('still treats a task with no ledger entry and no session as already gone', () => {
    const { code, out, calls } = runClean('gone-task', []);

    expect(code).toBe(0);
    expect(out).toMatch(/^OK gone-task/);
    expect(calls).not.toContain('kill-session');
  });
});
