/**
 * Shared constants used across server, extension, and webview.
 * Only constants needed by core interfaces live here.
 * Server-specific timing constants stay in server/src/constants.ts.
 * Webview-specific rendering constants stay in webview-ui/src/constants.ts.
 * Provider-specific constants stay in their provider directory.
 */

// ── Hook API ─────────────────────────────────────────────────

export const HOOK_API_PREFIX = '/api/hooks';
export const SERVER_JSON_DIR = '.pixel-agents';
export const SERVER_JSON_NAME = 'server.json';
export const HOOK_SCRIPTS_DIR = '.pixel-agents/hooks';

// ── Display ──────────────────────────────────────────────────

export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── Terminal (standalone embedded terminal) ──────────────────
// The raw PTY byte stream deliberately lives OUTSIDE the AsyncAPI contract --
// it is a data plane (unstructured, high-frequency), not a control plane.
// Only the terminal's control-plane facts (availability, session open/close)
// are AsyncAPI ServerMessages. See docs/design/standalone-terminal.md.

/** Path prefix for the per-agent terminal WebSocket: `/terminal/:agentId`. The
 *  handshake carries the server token as `?token=`, exactly like `/ws` (see
 *  server/src/wsAuth.ts); the frame shapes are in terminalFrames.ts. */
export const TERMINAL_WS_PREFIX = '/terminal';
/** The view-only share page (`/share/<token>`), its socket and its bundled script and style. */
export const SHARE_PAGE_PREFIX = '/share';
export const SHARE_WS_PREFIX = '/share-ws';
export const SHARE_ASSET_PREFIX = '/share-assets';
/** Share socket close codes, read by the server that sends them and the viewer page that explains them. */
/** The link is unknown, expired or revoked. */
export const WS_CLOSE_SHARE_UNKNOWN = 4404;
/** The link ended while the viewer was watching (revoked or expired). */
export const WS_CLOSE_SHARE_ENDED = 4410;
/** This link already has its viewers. */
export const WS_CLOSE_SHARE_FULL = 4429;

// ── Transport ────────────────────────────────────────────────
// Connection-state names for the MessageTransport state machine.

export const TRANSPORT_STATE_CONNECTING = 'connecting';
export const TRANSPORT_STATE_CONNECTED = 'connected';
export const TRANSPORT_STATE_RECONNECTING = 'reconnecting';
export const TRANSPORT_STATE_DISCONNECTED = 'disconnected';

// ── Browser reaper ───────────────────────────────────────────
// How long an omp headless browser must hold zero pages, on every check, before
// the server stops it. The server enforces it; the board states it.

export const BROWSER_REAPER_GRACE_MS = 10 * 60_000;
