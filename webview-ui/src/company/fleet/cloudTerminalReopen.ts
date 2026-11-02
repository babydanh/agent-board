/** The close code the board's /terminal socket answers when it holds no terminal with that id (mirrors the server's WS_CLOSE_NO_SESSION). */
export const CLOUD_TERMINAL_GONE_CODE = 4004;
/** A reopen that fails again within this time is left to the reader's "Nối lại", so a dying terminal cannot loop. */
export const CLOUD_TERMINAL_REOPEN_COOLDOWN_MS = 10_000;
/**
 * ssh's exit code when the connection itself failed or was cut. The instabox gateway (ssh.instabox.sh) closes long
 * sessions from its side now and then while the machine keeps running (measured 02/11/2026: two attaches to `danh`,
 * one with ServerAliveInterval=20, both ended at 07:51:30 UTC after 68 minutes with "closed by remote host", 255;
 * no pause, start or other operation on the machine at that time). The trigger is not known yet.
 */
export const SSH_CONNECTION_LOST_EXIT = 255;

/** When each terminal id last reopened by itself. Kept outside the view: every reopen mounts a new one. */
const lastSelfReopen = new Map<number, number>();

function cooledDown(lastReopenAt: number | null, now: number): boolean {
  return lastReopenAt === null || now - lastReopenAt >= CLOUD_TERMINAL_REOPEN_COOLDOWN_MS;
}

/**
 * The board forgets a terminal when its ssh process ends (a network drop) or when the board restarts, while this page
 * keeps the old id: the next attach is refused with 4004 and nothing ever came back. That one case reopens by itself.
 */
export function shouldReopenTerminal(input: { code: number; lastReopenAt: number | null; now: number }): boolean {
  return input.code === CLOUD_TERMINAL_GONE_CODE && cooledDown(input.lastReopenAt, input.now);
}

/**
 * The ssh behind the terminal ended. A lost connection (255) leaves tmux and the agent running, so attaching again is
 * safe and shows the same screen. Leaving tmux (0) or a session that is gone (1) stay closed.
 */
export function shouldReopenAfterExit(input: { exitCode: number; lastReopenAt: number | null; now: number }): boolean {
  return input.exitCode === SSH_CONNECTION_LOST_EXIT && cooledDown(input.lastReopenAt, input.now);
}

/**
 * Reopens this terminal by itself when `allowed` accepts the time of its last self-reopen, and records the new one.
 * The time lives per terminal id here, not in the view: a per-view time is gone after the remount every reopen does,
 * so a terminal that dies at once would reopen in a loop. False leaves it to the reader's "Nối lại".
 */
export function reopenOnce(
  terminalId: number,
  now: number,
  allowed: (lastReopenAt: number | null) => boolean,
  reopen: (() => void) | undefined,
): boolean {
  if (!reopen || !allowed(lastSelfReopen.get(terminalId) ?? null)) return false;
  lastSelfReopen.set(terminalId, now);
  reopen();
  return true;
}
