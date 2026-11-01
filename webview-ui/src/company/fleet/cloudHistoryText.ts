/** The history view holds the whole tmux scrollback the server reads (FLEET_HISTORY_LINES = 50 000) plus the visible screen. */
export const CLOUD_HISTORY_SCROLLBACK_LINES = 50_100;

/**
 * tmux pads a pane's capture with blank lines and ends lines with a bare "\n"; a terminal needs "\r\n" to return to
 * column 0, and the padding would leave the view opening on empty rows instead of the newest text.
 */
export function historyToTerminal(text: string): string {
  return text.replace(/\s+$/, '').replace(/\r?\n/g, '\r\n');
}
