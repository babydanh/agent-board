/**
 * shareRoutes: what a person holding a share link sees. No board token, no login: the link IS the
 * permission, and it only ever opens one terminal, read-only.
 *
 *   GET /share/:token      the viewer page (404 for an unknown, expired or revoked link)
 *   GET /share-ws/:token   the socket: a snapshot of the screen, then the live output
 *
 * SECURITY: the viewer socket never writes. Every frame a viewer sends is dropped before it can
 * reach the process, so a link cannot type, resize or interrupt anything. The socket does the
 * same cross-site check as the other sockets (a foreign Origin is refused), the page and socket
 * answer "no" the same way for a bad and an expired link, and the page tells caches and search
 * engines to forget it.
 */

import type { FastifyInstance } from 'fastify';

import { SHARE_ASSET_PREFIX, SHARE_PAGE_PREFIX, SHARE_WS_PREFIX } from '../../../core/src/constants.js';
import { encodeTerminalFrame } from '../../../core/src/terminalFrames.js';
import {
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_NO_SESSION,
  WS_CLOSE_SHARE_ENDED,
  WS_CLOSE_SHARE_FULL,
  WS_CLOSE_SHARE_UNKNOWN,
} from '../constants.js';
import type { PtySession } from '../terminal/ptySessionManager.js';
import { isAllowedWebSocketOrigin } from '../wsAuth.js';
import type { ShareStore } from './shareStore.js';

/** Viewers one link serves at once. */
export const SHARE_MAX_VIEWERS = 8;
/** How often expired links are ended even when nobody asks for them. */
const SWEEP_INTERVAL_MS = 30_000;
const TOKEN_PATTERN = '^[A-Za-z0-9_-]{16,64}$';
const WS_OPEN = 1;

/** What the viewer reads of a terminal: the screen, the output, the exit. Never a way to write. */
export type ShareFeed = Pick<PtySession, 'cols' | 'rows' | 'snapshot' | 'onData' | 'onExit'>;

export interface ShareRoutesOptions {
  readonly shares: ShareStore;
  /** The terminal behind a link, or undefined once it is gone. */
  readonly feedFor: (terminalId: number) => ShareFeed | undefined;
}

interface ViewerSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: () => void): void;
  on(event: 'close', listener: () => void): void;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function viewerPage(label: string): string {
  const title = escapeHtml(label);
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} · chỉ xem</title>
<link rel="stylesheet" href="${SHARE_ASSET_PREFIX}/viewer.css">
</head>
<body>
<header><strong>${title}</strong><span id="status">Đang kết nối…</span><em>Chỉ xem</em></header>
<main id="screen"></main>
<script src="${SHARE_ASSET_PREFIX}/viewer.js"></script>
</body>
</html>`;
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Link không dùng được</title></head><body style="font-family:system-ui;padding:2rem"><p>Link này đã hết hạn hoặc đã bị thu hồi.</p></body></html>`;

export function registerShareRoutes(app: FastifyInstance, options: ShareRoutesOptions): void {
  const { shares } = options;
  const viewers = new Map<string, Set<ViewerSocket>>();

  // A link that ends while people are watching closes their sockets at once.
  const stopListening = shares.onEnd((share) => {
    for (const socket of viewers.get(share.token) ?? []) socket.close(WS_CLOSE_SHARE_ENDED, 'share ended');
    viewers.delete(share.token);
  });
  const sweeper = setInterval(() => shares.sweep(), SWEEP_INTERVAL_MS);
  sweeper.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    stopListening();
  });

  app.get<{ Params: { token: string } }>(
    `${SHARE_PAGE_PREFIX}/:token`,
    { schema: { params: { type: 'object', properties: { token: { type: 'string', pattern: TOKEN_PATTERN } }, required: ['token'] } } },
    (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex, nofollow');
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      reply.type('text/html; charset=utf-8');
      const share = shares.get(request.params.token);
      if (share === undefined) return reply.code(404).send(NOT_FOUND_PAGE);
      return reply.send(viewerPage(share.label));
    },
  );

  app.get<{ Params: { token: string } }>(
    `${SHARE_WS_PREFIX}/:token`,
    {
      websocket: true,
      schema: { params: { type: 'object', properties: { token: { type: 'string', pattern: TOKEN_PATTERN } }, required: ['token'] } },
    },
    (socket: ViewerSocket, request) => {
      if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
        socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
        return;
      }
      const token = request.params.token;
      const share = shares.get(token);
      if (share === undefined) {
        socket.close(WS_CLOSE_SHARE_UNKNOWN, 'unknown link');
        return;
      }
      const feed = options.feedFor(share.terminalId);
      if (feed === undefined) {
        socket.close(WS_CLOSE_NO_SESSION, 'no terminal');
        return;
      }
      const watching = viewers.get(token) ?? new Set<ViewerSocket>();
      if (watching.size >= SHARE_MAX_VIEWERS) {
        socket.close(WS_CLOSE_SHARE_FULL, 'too many viewers');
        return;
      }
      watching.add(socket);
      viewers.set(token, watching);

      const send = (frame: string): void => {
        if (socket.readyState === WS_OPEN) socket.send(frame);
      };
      // Snapshot first, then live: output that arrives while the snapshot is taken waits behind it.
      let replaySent = false;
      const waiting: string[] = [];
      const forward = (frame: string): void => {
        if (replaySent) send(frame);
        else waiting.push(frame);
      };
      const offData = feed.onData((chunk) => forward(encodeTerminalFrame({ type: 'output', data: chunk })));
      const offExit = feed.onExit((exit) => forward(encodeTerminalFrame({ type: 'exit', exitCode: exit.exitCode, ...(exit.signal === undefined ? {} : { signal: exit.signal }) })));
      void feed.snapshot().then((data) => {
        send(encodeTerminalFrame({ type: 'replay', data, cols: feed.cols, rows: feed.rows }));
        replaySent = true;
        for (const frame of waiting) send(frame);
        waiting.length = 0;
      });

      // A viewer cannot talk to the process: whatever it sends is dropped unread.
      socket.on('message', () => undefined);
      socket.on('close', () => {
        offData();
        offExit();
        watching.delete(socket);
        if (watching.size === 0) viewers.delete(token);
      });
    },
  );
}
