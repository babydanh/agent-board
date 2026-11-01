import { FLEET_SESSION_NAME } from './constants.js';
import type { FleetHubTmux } from './hubClient.js';

/** One remote shell line: every tmux pane as `session|attached|last-activity-epoch|cwd`. Names never reach it. */
export const TMUX_PANES_SCRIPT = "tmux list-panes -a -F '#{session_name}|#{session_attached}|#{session_activity}|#{pane_current_path}' 2>/dev/null";

/** The machines `instabox ls --json` reports as running; any other state (suspended, paused) is left asleep. */
export function runningMachineNames(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((box: unknown) =>
      box && typeof box === 'object' && 'name' in box && typeof box.name === 'string' && 'state' in box && box.state === 'running' ? [box.name] : [],
    );
  } catch {
    return [];
  }
}

/** The tmux sessions of a pane dump, first pane per session; malformed lines and odd names are skipped. */
export function parseTmuxPanes(dump: string, nowSeconds: number): FleetHubTmux[] {
  const sessions = new Map<string, FleetHubTmux>();
  for (const line of dump.split('\n')) {
    const [name, attached, activity, ...cwd] = line.trim().split('|');
    if (name === undefined || activity === undefined || !FLEET_SESSION_NAME.test(name) || sessions.has(name)) continue;
    const lastActive = Number(activity);
    sessions.set(name, {
      name,
      attached: Number(attached) > 0,
      idle_seconds: Number.isFinite(lastActive) ? Math.max(0, Math.round(nowSeconds - lastActive)) : 0,
      ...(cwd.length > 0 && cwd.join('|') !== '' ? { cwd: cwd.join('|') } : {}),
    });
  }
  return [...sessions.values()];
}
