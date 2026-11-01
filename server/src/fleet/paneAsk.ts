import { FLEET_PEEK_DUMP_LINES, FLEET_PEEK_MARKER, FLEET_PEEK_TAIL_LINES } from './constants.js';

/**
 * Reading what a Claude Code pane asks of the user. Claude cloud sessions have no board-side channel for a question or a
 * permission prompt (omp has one), so the board reads the bottom of the tmux pane: a numbered menu with its footer hint.
 */

const MENU_OPTION = /^\s*(?:[❯>]\s*)?1\.\s+\S/;
const MENU_FOOTER = /Esc to cancel|Enter to select|to navigate/;

const ANY_OPTION = /^\s*(?:[❯>]\s*)?\d+\.\s+\S/;
const BOX_DRAWING = /[│┃╭╮╰╯─━┌┐└┘]/g;
const BULLET = /^[●⏺]\s*/;
const QUESTION_MAX_CHARS = 300;

function tidy(line: string): string {
  return line.replace(BOX_DRAWING, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * What the Claude Code menu at the bottom of the screen asks, as one line: the question above the numbered options,
 * then the options. Null when the bottom of the screen is no menu (a numbered list alone is not one).
 */
export function askedQuestion(screen: string): string | null {
  // The rows under the last text are an empty screen, not content: a fresh pane has its menu near the top.
  const bottom = screen.trimEnd().split('\n').slice(-FLEET_PEEK_TAIL_LINES);
  const first = bottom.findIndex((line) => MENU_OPTION.test(line));
  if (first < 0 || !bottom.some((line) => MENU_FOOTER.test(line))) return null;
  const head = bottom
    .slice(0, first)
    .map(tidy)
    .filter((line) => line !== '')
    .pop();
  const options = bottom
    .slice(first)
    .filter((line) => ANY_OPTION.test(line))
    .map((line) => tidy(line).replace(/^[❯>]\s*/, ''));
  const optionLine = options.join(' / ');
  const text = head === undefined ? optionLine : `${head.replace(BULLET, '')} — ${optionLine}`;
  return text.slice(0, QUESTION_MAX_CHARS);
}

/** True when the bottom of the screen is a Claude Code menu waiting for a choice. */
export function screenAsksUser(screen: string): boolean {
  return askedQuestion(screen) !== null;
}

/** One remote shell line: the bottom of every tmux session's active pane, each under a marker line. Names never reach it. */
export const PANE_PEEK_SCRIPT =
  `tmux list-sessions -F '#{session_name}' 2>/dev/null | while IFS= read -r s; do ` +
  `echo "${FLEET_PEEK_MARKER} $s"; tmux capture-pane -p -t "=$s:" 2>/dev/null | tail -n ${FLEET_PEEK_DUMP_LINES}; done`;

/** The sessions of a peek dump whose screen asks the user something, each with what it asks. */
export function parsePanePeek(dump: string): Map<string, string> {
  const asking = new Map<string, string>();
  let session: string | null = null;
  let screen: string[] = [];
  const close = (): void => {
    if (session === null) return;
    const question = askedQuestion(screen.join('\n'));
    if (question !== null) asking.set(session, question);
  };
  for (const line of dump.split('\n')) {
    if (line.startsWith(`${FLEET_PEEK_MARKER} `)) {
      close();
      session = line.slice(FLEET_PEEK_MARKER.length + 1).trim();
      screen = [];
    } else if (session !== null) {
      screen.push(line);
    }
  }
  close();
  return asking;
}
