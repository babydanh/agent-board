import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

import type { GitGuardReport } from '../../../core/src/messages.js';

export const LOCAL_GUARD_SCAN_INTERVAL_MS = 10 * 60_000;
const BACKUP_INTERVAL_MS = 30 * 60_000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60_000;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
// A function, not a constant: homedir() read while the module loads is undefined under a test that fakes it later.
const defaultWindowsRoots = (): string[] => [
  'V:/Duancanhan/Project_QuanLyGiaiDau',
  'V:/pixel-agents',
  path.join(homedir(), '.omp'),
];

export function localGuardRoots(value = process.env['PIXEL_AGENTS_GIT_GUARD_ROOTS']): string[] {
  if (value !== undefined)
    return value
      .split(path.delimiter)
      .map((root) => root.trim())
      .filter(Boolean);
  return process.platform === 'win32' ? defaultWindowsRoots() : [process.cwd()];
}

async function runChild(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`Local prune process exited with ${code}.`);
}

export class LocalGuardScanner {
  private report: GitGuardReport | null = null;
  private timer: NodeJS.Timeout | null = null;
  private child: ChildProcess | null = null;
  private running = false;
  private lastBackupAt = 0;
  private lastPruneAt = 0;

  constructor(
    private readonly scriptPath: string,
    private readonly roots: readonly string[] = localGuardRoots(),
  ) {}

  start(): void {
    if (this.timer !== null) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, LOCAL_GUARD_SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  snapshot(): GitGuardReport | null {
    return this.report;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.child?.kill();
    this.child = null;
  }

  private async runGuard(backup: boolean): Promise<void> {
    const args = this.roots.flatMap((root) => ['--root', root]);
    args.push('--machine', 'local', '--json');
    if (backup) args.push('--fetch', '--backup');
    const child = spawn(process.execPath, [this.scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.child = child;
    let stdout = '';
    let bytes = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REPORT_BYTES) child.kill();
      else stdout += chunk;
    });
    const closed = once(child, 'close');
    let code: number | null;
    try {
      code = (await closed)[0] as number | null;
    } finally {
      if (this.child === child) this.child = null;
    }
    if (bytes > MAX_REPORT_BYTES)
      throw new Error('Local git-guard report exceeded its size limit.');
    if (code !== 0) throw new Error(`Local git-guard exited with ${code}.`);
    const parsed = JSON.parse(stdout) as GitGuardReport;
    if (
      parsed.machine !== 'local' ||
      !Array.isArray(parsed.repos) ||
      !Array.isArray(parsed.risks)
    ) {
      throw new Error('Local git-guard returned an invalid report.');
    }
    this.report = parsed;
  }

  private async pruneLocalWorktrees(): Promise<void> {
    const script = path.join(homedir(), '.omp', 'scripts', 'who.py');
    if (!existsSync(script)) return;
    await runChild(process.env['PYTHON'] ?? 'python', [script, 'prune', '--yes']);
  }

  private async tick(): Promise<void> {
    if (this.running || !existsSync(this.scriptPath)) return;
    this.running = true;
    try {
      const now = Date.now();
      const backup = this.lastBackupAt === 0 || now - this.lastBackupAt >= BACKUP_INTERVAL_MS;
      await this.runGuard(backup);
      if (backup) this.lastBackupAt = Date.now();
      if (this.lastPruneAt === 0 || Date.now() - this.lastPruneAt >= PRUNE_INTERVAL_MS) {
        await this.pruneLocalWorktrees();
        this.lastPruneAt = Date.now();
      }
    } catch (error) {
      console.error(
        `[Pixel Agents] Local git guard failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
