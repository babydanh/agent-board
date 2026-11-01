// Packs the fleet hub for the Botkeep dashboard (Files -> Extract): the hub, its JWT check, this entry point and the manifest.
// No keys, no state, no node_modules (the platform runs `npm install` itself; the hub has no dependencies).
// Run: node fleet/botkeep-hub/build-zip.mjs   (uses bsdtar, so zip paths use '/').
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fleet = dirname(here);
const outDir = join(here, 'out');
const zipPath = join(outDir, 'botkeep-fleet-hub.zip');

// Git Bash puts GNU tar first on PATH; it cannot write zips and reads "V:" as a remote host. Windows ships bsdtar.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync(tar, ['-a', '-c', '-f', zipPath, '-C', fleet, 'hub.mjs', 'jwt.mjs', '-C', here, 'package.json', 'server.js']);
console.log(execFileSync(tar, ['-t', '-f', zipPath], { encoding: 'utf8' }).trim());
console.log(`wrote ${zipPath}`);
