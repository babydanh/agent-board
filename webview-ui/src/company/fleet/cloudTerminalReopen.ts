/** The close code the board's /terminal socket answers when it holds no terminal with that id (mirrors the server's WS_CLOSE_NO_SESSION). */
export const CLOUD_TERMINAL_GONE_CODE = 4004;
/** A reopen that fails again within this time is left to the reader's "Nối lại", so a dying terminal cannot loop. */
export const CLOUD_TERMINAL_REOPEN_COOLDOWN_MS = 10_000;

/**
 * The board forgets a terminal when its ssh process ends (a network drop) or when the board restarts, while this page
 * keeps the old id: the next attach is refused with 4004 and nothing ever came back. That one case reopens by itself.
 */
export function shouldReopenTerminal(input: { code: number; lastReopenAt: number | null; now: number }): boolean {
  if (input.code !== CLOUD_TERMINAL_GONE_CODE) return false;
  return input.lastReopenAt === null || input.now - input.lastReopenAt >= CLOUD_TERMINAL_REOPEN_COOLDOWN_MS;
}
