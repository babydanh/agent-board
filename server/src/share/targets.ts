/**
 * targets: what a share link can point at, and the read-only feed behind each kind.
 *
 *  - cloud   a cloud tmux session's PTY on this board (id above FLEET_TERMINAL_ID_BASE only);
 *  - company an omp session the board runs, through the terminal gateway's `peek`;
 *  - herdr   a herdr pane, repainted from its screen text.
 *
 * `refusal` says why a target cannot be shared right now; `feedFor` is what the viewer socket reads.
 * Neither can write: a feed only has a snapshot, output and an exit.
 */

import type { TerminalPeek } from '../company/clientCommands.js';
import { FLEET_TERMINAL_ID_BASE } from '../fleet/constants.js';
import type { HerdrLink } from '../herdr/herdrLink.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import type { ShareFeed } from './shareRoutes.js';
import type { ShareTarget } from './shareStore.js';

export const SHARE_REASON_NOT_CLOUD = 'Chỉ share được phiên cloud, phiên omp của board hoặc pane herdr, không share terminal của máy này.';
export const SHARE_REASON_NO_TERMINAL = 'Phiên này không còn chạy nên không share được.';

/** A herdr screen watch lapses 30 s after its last renewal; renewing well inside that keeps it open. */
const HERDR_WATCH_RENEW_MS = 10_000;
/** A viewer gets at most one repaint per this long; a busy pane would otherwise send a whole screen several times a second. */
const HERDR_REPAINT_MIN_INTERVAL_MS = 500;
/** How much of a pane the first view shows. */
const HERDR_SNAPSHOT_LINES = 200;
const HERDR_MIN_COLS = 120;
const HERDR_MAX_COLS = 400;
const HERDR_MIN_ROWS = 24;
const HERDR_MAX_ROWS = 300;
/** Clear the screen and scrollback, then home the cursor: every herdr update repaints from the top. */
const REPAINT = '\x1b[2J\x1b[3J\x1b[H';
 
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export interface ShareTargetSources {
  readonly ptyManager?: Pick<PtySessionManager, 'has' | 'get'>;
  readonly herdr?: Pick<HerdrLink, 'snapshot' | 'read' | 'watch' | 'onScreen' | 'onAgents'> | null;
  /** A read-only view of an omp session's live terminal, or undefined when it has none. */
  readonly companyPeek?: (sessionId: string) => TerminalPeek | undefined;
}

export interface ShareTargets {
  /** Why this target cannot be shared now, or null when it can. */
  refusal(target: ShareTarget): string | null;
  /** The live feed behind a target, or undefined once it is gone. */
  feedFor(target: ShareTarget): ShareFeed | undefined;
}

function toTerminalLines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** Size that fits a screen of text: wide enough for its longest visible line, tall enough for all of it. */
function sizeFor(text: string): { cols: number; rows: number } {
  const lines = text.split(/\r?\n/);
  const widest = lines.reduce((max, line) => Math.max(max, [...line.replace(ANSI_PATTERN, '')].length), 0);
  return {
    cols: Math.min(Math.max(widest, HERDR_MIN_COLS), HERDR_MAX_COLS),
    rows: Math.min(Math.max(lines.length, HERDR_MIN_ROWS), HERDR_MAX_ROWS),
  };
}

function herdrFeed(link: NonNullable<ShareTargetSources['herdr']>, paneId: string): ShareFeed {
  let size = { cols: HERDR_MIN_COLS, rows: HERDR_MIN_ROWS };
  return {
    get cols() {
      return size.cols;
    },
    get rows() {
      return size.rows;
    },
    snapshot: async () => {
      const { text } = await link.read(paneId, HERDR_SNAPSHOT_LINES);
      size = sizeFor(text);
      return toTerminalLines(text);
    },
    onData: (listener) => {
      link.watch(paneId, true);
      const renew = setInterval(() => link.watch(paneId, true), HERDR_WATCH_RENEW_MS);
      // Leading plus trailing: the first change goes out at once, later ones inside the window
      // collapse into one repaint of the newest screen when the window ends.
      let lastSentAt = 0;
      let waiting: ReturnType<typeof setTimeout> | undefined;
      let newest = '';
      const send = (): void => {
        waiting = undefined;
        lastSentAt = Date.now();
        size = sizeFor(newest);
        listener(REPAINT + toTerminalLines(newest));
      };
      const off = link.onScreen((message) => {
        if (message.paneId !== paneId) return;
        newest = message.text;
        if (waiting !== undefined) return;
        const wait = lastSentAt + HERDR_REPAINT_MIN_INTERVAL_MS - Date.now();
        if (wait <= 0) send();
        else waiting = setTimeout(send, wait);
      });
      return () => {
        clearInterval(renew);
        clearTimeout(waiting);
        off();
      };
    },
    onExit: (listener) => {
      let listed = true;
      return link.onAgents((message) => {
        const present = message.agents.some((agent) => agent.paneId === paneId);
        if (listed && !present) listener({ exitCode: 0 });
        listed = present;
      });
    },
  };
}

export function createShareTargets(sources: ShareTargetSources): ShareTargets {
  const herdrHas = (paneId: string): boolean =>
    sources.herdr?.snapshot().agents.some((agent) => agent.paneId === paneId) === true;

  return {
    refusal(target) {
      switch (target.kind) {
        case 'cloud':
          if (target.terminalId <= FLEET_TERMINAL_ID_BASE) return SHARE_REASON_NOT_CLOUD;
          return sources.ptyManager?.has(target.terminalId) === true ? null : SHARE_REASON_NO_TERMINAL;
        case 'company':
          return sources.companyPeek?.(target.sessionId) === undefined ? SHARE_REASON_NO_TERMINAL : null;
        case 'herdr':
          return herdrHas(target.paneId) ? null : SHARE_REASON_NO_TERMINAL;
      }
    },
    feedFor(target) {
      switch (target.kind) {
        case 'cloud':
          return target.terminalId <= FLEET_TERMINAL_ID_BASE ? undefined : sources.ptyManager?.get(target.terminalId);
        case 'company':
          return sources.companyPeek?.(target.sessionId);
        case 'herdr':
          return sources.herdr && herdrHas(target.paneId) ? herdrFeed(sources.herdr, target.paneId) : undefined;
      }
    },
  };
}
