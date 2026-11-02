// Installs the local fleet reporter so it runs after every Windows logon without a terminal.
// It copies the reporter's modules into ~/.pixel-agents/fleet-agent/ (so the reporter does not depend on a worktree that
// may be removed) and puts a hidden launcher in the user's Startup folder. No admin rights, no scheduled task.
//   node fleet/install-local-task.mjs            print the plan only
//   node fleet/install-local-task.mjs --apply    copy, write the launcher and start the reporter now
//   node fleet/install-local-task.mjs --remove   delete the launcher and the copied folder (the key and config stay)
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Every module local-agent.mjs reaches through relative imports (TC-LOCALTASK-07 keeps this list honest).
export const AGENT_FILES = [
  'agent.mjs', 'commands.mjs', 'commandSpec.mjs', 'git-guard.mjs', 'judge.mjs', 'judgeRun.mjs', 'jwt.mjs',
  'laneScan.mjs', 'ledgerReport.mjs', 'local-agent.mjs', 'overlapFile.mjs', 'snapshot.mjs', 'snapshotFilter.mjs',
];
export const LAUNCHER_NAME = 'pixel-agents-fleet-local.vbs';
const AGENT_DIR_NAME = 'fleet-agent';

/** Where everything goes, and the launcher text. Pure: nothing is written. */
export function planInstall({ srcDir, home, appData, node }) {
  for (const value of [srcDir, home, appData, node]) {
    if (String(value).includes('"')) throw new Error('a path with a double quote cannot go into the launcher');
  }
  const destDir = join(home, '.pixel-agents', AGENT_DIR_NAME);
  const agent = join(destDir, 'local-agent.mjs');
  return {
    srcDir,
    destDir,
    agent,
    node,
    files: AGENT_FILES,
    launcherPath: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', LAUNCHER_NAME),
    // Window style 0 hides the console; False means the launcher does not wait for the loop to end.
    launcher: `CreateObject("WScript.Shell").Run """${node}"" ""${agent}"" --loop", 0, False\r\n`,
  };
}

export function install(plan) {
  mkdirSync(plan.destDir, { recursive: true });
  for (const name of plan.files) copyFileSync(join(plan.srcDir, name), join(plan.destDir, name));
  mkdirSync(dirname(plan.launcherPath), { recursive: true });
  writeFileSync(plan.launcherPath, plan.launcher);
}

export function remove(plan) {
  // The folder is deleted recursively, so only the one this installer creates may ever be named here.
  if (basename(plan.destDir) !== AGENT_DIR_NAME) throw new Error(`refusing to delete a folder that is not ${AGENT_DIR_NAME}`);
  rmSync(plan.launcherPath, { force: true });
  rmSync(plan.destDir, { recursive: true, force: true });
}

function main(argv) {
  const plan = planInstall({
    srcDir: dirname(fileURLToPath(import.meta.url)),
    home: homedir(),
    appData: process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    node: process.execPath,
  });
  if (argv.includes('--remove')) {
    remove(plan);
    console.log(`removed ${plan.launcherPath} and ${plan.destDir}`);
    return;
  }
  if (!argv.includes('--apply')) {
    console.log(`copy ${plan.files.join(', ')}\n  from ${plan.srcDir}\n  to   ${plan.destDir}\nwrite ${plan.launcherPath}\nrun with --apply to do it, --remove to undo`);
    return;
  }
  install(plan);
  spawn(plan.node, [plan.agent, '--loop'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log(`installed; the reporter is running now and starts again at every logon (${plan.launcherPath})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
