/**
 * The view-only share page. It opens `/share-ws/<token>`, draws what the server sends and never
 * sends anything back: the terminal has stdin disabled and the server drops every client frame.
 */

import '@xterm/xterm/css/xterm.css';
import './viewer.css';

import { Terminal } from '@xterm/xterm';

import {
  SHARE_WS_PREFIX,
  WS_CLOSE_SHARE_ENDED,
  WS_CLOSE_SHARE_FULL,
  WS_CLOSE_SHARE_UNKNOWN,
} from '../../../core/src/constants.js';
import { parseServerFrame } from '../../../core/src/terminalFrames.js';
import { TERMINAL_FONT_SIZE_PX, TERMINAL_SCROLLBACK_LINES, TERMINAL_THEME } from '../constants.js';

const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace';
const RECONNECT_DELAY_MS = 2000;
const FINAL_REASONS = new Map<number, string>([
  [WS_CLOSE_SHARE_UNKNOWN, 'Link không dùng được: đã hết hạn hoặc bị thu hồi.'],
  [WS_CLOSE_SHARE_ENDED, 'Người share đã dừng link này, hoặc link đã hết hạn.'],
  [WS_CLOSE_SHARE_FULL, 'Link này đang đủ người xem. Thử lại sau.'],
]);

const screen = document.getElementById('screen');
const statusLine = document.getElementById('status');
const token = window.location.pathname.split('/').filter(Boolean).pop();

function setStatus(text: string): void {
  if (statusLine) statusLine.textContent = text;
}

if (screen && token) {
  const term = new Terminal({
    fontSize: TERMINAL_FONT_SIZE_PX,
    fontFamily: TERMINAL_FONT_FAMILY,
    scrollback: TERMINAL_SCROLLBACK_LINES,
    theme: TERMINAL_THEME,
    disableStdin: true,
    cursorBlink: false,
    convertEol: false,
  });
  term.open(screen);

  const connect = (): void => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}${SHARE_WS_PREFIX}/${encodeURIComponent(token)}`);
    socket.onopen = () => setStatus('Đang xem trực tiếp');
    socket.onmessage = (event: MessageEvent) => {
      const frame = parseServerFrame(String(event.data));
      if (!frame) return;
      if (frame.type === 'replay') {
        term.reset();
        term.resize(frame.cols, frame.rows);
        term.write(frame.data);
      } else if (frame.type === 'output') {
        term.write(frame.data);
      } else {
        setStatus(`Phiên đã kết thúc (mã ${frame.exitCode}).`);
      }
    };
    socket.onclose = (event: CloseEvent) => {
      const final = FINAL_REASONS.get(event.code);
      if (final) {
        setStatus(final);
        return;
      }
      // A dropped connection reconnects on its own; the first frame of the new one redraws the screen.
      setStatus('Mất kết nối, đang thử lại…');
      window.setTimeout(connect, RECONNECT_DELAY_MS);
    };
  };
  connect();
} else {
  setStatus('Link không hợp lệ.');
}
