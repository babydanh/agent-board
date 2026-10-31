// Packs the gateway for the Botkeep dashboard (Files -> Extract). Runtime files only: no tests, agent or node_modules;
// the platform runs `npm install` itself. Run: node relay/build-zip.mjs   (uses bsdtar, so zip paths use '/').
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(root, 'out');
const zipPath = join(outDir, 'botkeep-relay.zip');
const FILES = ['package.json', 'server.js', 'lib/gateway.js', 'lib/mux.js'];

// Git Bash puts GNU tar first on PATH; it cannot write zips and reads "V:" as a remote host. Windows ships bsdtar.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync(tar, ['-a', '-c', '-f', zipPath, ...FILES], { cwd: root });
console.log(execFileSync(tar, ['-t', '-f', zipPath], { cwd: root, encoding: 'utf8' }).trim());
console.log(`wrote ${zipPath}`);
