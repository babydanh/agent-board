/**
 * Company UI constants.
 *
 * These live beside the company surface rather than in the app-wide constants
 * file because they are the limits the BOARD obeys, and several of them mirror
 * the server's protocol limits (server/src/company/constants.ts) so the client
 * can refuse an oversized payload before paying for a round trip. The server
 * still enforces every one of them; matching here is a courtesy, not the rule.
 *
 * No color literals: the board is chrome, and chrome uses the CSS pixel tokens.
 */

import type { IconName } from './iconNames.js';

/** Board lanes, in the order they are drawn. */
export const COMPANY_LANE_ORDER = [
  'planned',
  'ready',
  'running',
  'needs_input',
  'review',
  'cloud',
  'done',
  'failed',
] as const;

export type CompanyLaneId = (typeof COMPANY_LANE_ORDER)[number];

export const COMPANY_LANE_LABELS: Record<CompanyLaneId, string> = {
  planned: 'Kế hoạch',
  ready: 'Sẵn sàng',
  running: 'Đang làm',
  needs_input: 'Chờ bạn',
  review: 'Kiểm',
  cloud: 'Trên cloud',
  done: 'Xong',
  failed: 'Lỗi',
};

/** Who holds a card in each lane: the owner line printed under the lane label. */
export const COMPANY_LANE_OWNERS: Record<CompanyLaneId, string> = {
  planned: 'Giám đốc',
  ready: 'đã duyệt',
  running: 'Nhân viên',
  needs_input: 'bạn trả lời',
  review: 'QA → Trọng tài',
  cloud: 'Agent Orchestrator',
  done: 'exit 0 · pass',
  failed: 'hết lượt thử',
};

/** The icon printed before each lane's label, so a column reads at a glance. */
export const COMPANY_LANE_ICONS: Record<CompanyLaneId, IconName> = {
  planned: 'pencil',
  ready: 'flag',
  running: 'play',
  needs_input: 'help',
  review: 'eye',
  cloud: 'external',
  done: 'check',
  failed: 'x-circle',
};

/** Excerpt length for the public assistant text shown in a bubble. */
export const COMPANY_TEXT_EXCERPT_GRAPHEMES = 160;

/**
 * Characters of live text kept per session. A bubble shows an excerpt, not a
 * transcript: the full output lives in an artifact the user opens deliberately.
 */
export const COMPANY_TEXT_STREAM_MAX_CHARS = 8000;

/** Text deltas coalesce for this long before React re-renders. */
export const COMPANY_TEXT_BATCH_MS = 100;

/** Mirrors COMPANY_ARTIFACT_PAGE_BYTES / COMPANY_FILE_DEFAULT_PAGE_BYTES. */
export const COMPANY_ARTIFACT_PAGE_BYTES = 64 * 1024;
export const COMPANY_FILE_PAGE_BYTES = 64 * 1024;

/** Mirrors COMPANY_MAX_PROMPT_BYTES. */
export const COMPANY_MAX_PROMPT_BYTES = 2 * 1024 * 1024;

/** Mirrors COMPANY_TERMINAL_INPUT_MAX_BYTES and the default PTY geometry. */
export const COMPANY_TERMINAL_INPUT_CHUNK_BYTES = 8 * 1024;
export const COMPANY_TERMINAL_DEFAULT_COLS = 120;
export const COMPANY_TERMINAL_DEFAULT_ROWS = 32;

/**
 * Frames kept per terminal; the oldest fall off first. A view that painted them
 * loses nothing; one that never did sees the gap and asks for a fresh screen. An
 * unbounded queue is a memory leak with a scrollbar.
 */
export const COMPANY_TERMINAL_FRAME_QUEUE_MAX = 512;

/** Session log entries kept per session; the oldest fall off first. */
export const COMPANY_SESSION_LOG_MAX_ENTRIES = 1000;

/** Sidebar width bounds and default, in CSS pixels. */
export const COMPANY_SIDEBAR_MIN_WIDTH_PX = 240;
export const COMPANY_SIDEBAR_MAX_WIDTH_PX = 480;
export const COMPANY_SIDEBAR_DEFAULT_WIDTH_PX = 300;

/** The collapsed agent rail's width: an 84px badge (code over status word) per agent, with a margin either side. */
export const COMPANY_RAIL_WIDTH_PX = 96;

/** Herdr screen lines requested per read. */
export const HERDR_SCREEN_LINES = 200;

/**
 * How often a live herdr screen renews its server watch. The server ends a watch that goes
 * unrenewed for 30 seconds, so this renews well inside that window.
 */
export const HERDR_WATCH_RENEW_MS = 10_000;

/**
 * How often the Project tree is re-requested while the tab is visible. The server reuses a build
 * younger than 3 seconds, so this stays cheap while a new session shows up within a few seconds.
 */
export const PROJECT_TREE_REFRESH_MS = 5_000;

/**
 * Board motion: every duration, stagger, lift, tone and curve the company board
 * animates. flip.ts, CompanyBoard and DetailDrawer read these, and the board's
 * CSS reads the same values through custom properties set inline. Durations are
 * milliseconds; distances are CSS pixels.
 */
export const COMPANY_MOTION = {
  /** Ease-out cubic: quick off the mark, settling softly. Flights sample the same curve in flip.ts. */
  easing: 'cubic-bezier(.33,1,.68,1)',
  /** A lane column's width, when the board resizes and the lanes re-pack. */
  laneWidthMs: 420,
  /** A card that changes lane flies this long: inside the 650-800ms band. */
  flightMs: 760,
  /** How far a flying card lifts off its straight path, at the midpoint of its travel. */
  flightLiftPx: 16,
  /** How many samples a flight's arc is built from; the path is linear between them. */
  flightSteps: 20,
  /** A flying card starts at this scale and settles to 1 at its new place. */
  flightScaleFrom: 0.98,
  /** The surface a flying card rises to: one step above its resting raised tone, back at rest on landing. */
  flightTone: 'var(--color-hover)',
  /** Each card in one render starts this much after the card before it, so a wave cascades. */
  flightStaggerMs: 40,
  /** A card that moves within its own lane glides, translate only. */
  glideMs: 300,
  /** A card that arrives fades in and rises. */
  enterMs: 300,
  enterRisePx: 8,
  /** The detail drawer's slide, open and closed. */
  drawerSlideMs: 320,
} as const;

/** Detail drawer width bounds, in CSS pixels. The drawer never leaves the lanes fewer than their visible minimum. */
export const COMPANY_DRAWER_MIN_WIDTH_PX = 280;
export const COMPANY_DRAWER_DEFAULT_WIDTH_PX = 560;
/** An unresized drawer takes this share of the board, at most the default width. */
export const COMPANY_DRAWER_DEFAULT_SHARE = 0.4;

/**
 * A lane's comfortable width: the drawer never narrows the board below
 * COMPANY_LANES_VISIBLE_MIN lanes this wide. The lanes themselves fill the board's width.
 */
export const COMPANY_LANE_WIDTH_PX = 272;

/** The narrowest a lane gets: below this a card's title and activity cannot be read, so the lanes wrap onto another row. */
export const COMPANY_LANE_MIN_WIDTH_PX = 200;

/** The gap between lane columns: 6px, the 1.5 step of the 4px rhythm. */
export const COMPANY_LANE_GAP_PX = 6;

/** Viewport widths that pick the board's layout: a phone below 768px, a tablet below 1024px. */
export const COMPANY_PHONE_MAX_PX = 767;
export const COMPANY_TABLET_MAX_PX = 1023;
/** The viewport width at and below which the page navigation becomes a menu button with a drawer. */
export const COMPANY_NAV_MOBILE_MAX_PX = 768;

/** Page transition timing. */
export const COMPANY_PAGE_TRANSITION_MS = 180;

/** The composer's text box idles at this many rows and grows with its text. */
export const COMPOSER_MIN_ROWS = 2;

/** The most rows the composer's text box grows to before it scrolls. */
export const COMPOSER_MAX_ROWS = 12;

/** How many lanes stay visible beside a docked drawer. */
export const COMPANY_LANES_VISIBLE_MIN = 2;

/** How far one arrow key moves the drawer's resize handle; with Shift, the large step. */
export const COMPANY_DRAWER_RESIZE_STEP_PX = 16;
export const COMPANY_DRAWER_RESIZE_LARGE_STEP_PX = 64;

/**
 * How long the board waits for a cloud machine's answer before it stops locking the buttons and offers a retry.
 * Each is the server's own limit for that command (server/src/fleet/constants.ts, cloudControl.ts) plus a margin,
 * so a healthy slow command (a paused machine waking, a task being created) is never cut short.
 */
export const FLEET_ACTION_TIMEOUT_MS = {
  terminal: 180_000,
  task: 330_000,
  clean: 150_000,
  wake: 150_000,
  lavish: 90_000,
  lavishDelete: 90_000,
  restart: 150_000,
  diff: 150_000,
  history: 90_000,
  comment: 60_000,
  branch: 150_000,
  command: 60_000,
  commands: 60_000,
} as const;

/** After this long a visible wait says it is slower than usual and offers to stop waiting. */
export const BUSY_SLOW_AFTER_MS = 20_000;

/** A project-tree write (create, delete, move, update, stop, wake) the server has not answered by now is reported as failed, so no wait hangs and no failure stays silent. */
export const PROJECT_COMMAND_TIMEOUT_MS = 60_000;
