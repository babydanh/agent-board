/** After the history view opened by scrolling, the same scroll gesture must not reopen it right after it is closed. */
export const CLOUD_HISTORY_AUTO_COOLDOWN_MS = 10_000;

/**
 * Scrolling up past the top of the live terminal asks for the history view: the live view only holds what was
 * streamed since it attached, so the older text has to come from the machine's tmux scrollback.
 */
export function shouldOpenHistory(input: {
  deltaY: number;
  viewportY: number;
  busy: boolean;
  lastOpenedAt: number | null;
  now: number;
}): boolean {
  if (input.deltaY >= 0 || input.viewportY > 0 || input.busy) return false;
  return input.lastOpenedAt === null || input.now - input.lastOpenedAt >= CLOUD_HISTORY_AUTO_COOLDOWN_MS;
}
