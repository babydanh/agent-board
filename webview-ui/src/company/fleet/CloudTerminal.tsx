import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';

import { TERMINAL_WS_PREFIX } from '../../../../core/src/constants.js';
import { encodeTerminalFrame, parseServerFrame } from '../../../../core/src/terminalFrames.js';
import { TERMINAL_FONT_SIZE_PX, TERMINAL_SCROLLBACK_LINES, TERMINAL_THEME } from '../../constants.js';
import { serverToken } from '../../transport/serverToken.js';
import { registerCloudInput } from './cloudInput.js';
import { exitScreen } from './cloudTerminalExit.js';

/** xterm's own default stack starts with Courier New, which is thin and uneven on Windows; these ship with the OS. */
const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace';

/**
 * One cloud tmux session, live. The board server holds a local PTY running
 * `instabox ssh <machine> -- tmux attach`; this connects to it over the same
 * token- and Origin-checked `/terminal/:id` socket local agents use. Bytes flow
 * only while this component is mounted: closing it detaches (tmux and the agent
 * keep running on the machine).
 */
export function CloudTerminal({ terminalId, label, onClose, fill = false }: { terminalId: number; label: string; onClose: () => void; fill?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Đang nối tới máy (máy ngủ thì mất 1–2 phút)…');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontSize: TERMINAL_FONT_SIZE_PX,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: TERMINAL_THEME,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    // The default DOM renderer repaints thousands of nodes per scroll or TUI redraw; WebGL draws on the GPU.
    // Without WebGL (or after the context is lost) xterm keeps drawing with its DOM renderer.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // keep the DOM renderer
    }
    fit.fit();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = serverToken ? `?token=${encodeURIComponent(serverToken)}` : '';
    const socket = new WebSocket(`${protocol}//${window.location.host}${TERMINAL_WS_PREFIX}/${terminalId}${query}`);
    const sendResize = (): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodeTerminalFrame({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    socket.onopen = () => {
      setStatus('');
      sendResize();
    };
    socket.onmessage = (event: MessageEvent) => {
      const frame = parseServerFrame(String(event.data));
      if (!frame) return;
      if (frame.type === 'replay') {
        term.reset();
        term.write(frame.data);
      } else if (frame.type === 'output') {
        term.write(frame.data);
      } else {
        const reason = `Phiên SSH đã đóng (mã ${frame.exitCode}). Agent trên máy vẫn chạy trong tmux.`;
        const buffer = term.buffer.active;
        const lines = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '');
        term.reset();
        term.write(exitScreen(lines, reason));
        setStatus(reason);
      }
    };
    socket.onclose = (event: CloseEvent) => {
      if (event.code !== 1000) setStatus(`Mất kết nối terminal (${event.code}${event.reason ? `: ${event.reason}` : ''}).`);
    };
    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeTerminalFrame({ type: 'input', data }));
    });
    // The composer types into this session through the same socket.
    const unregister = registerCloudInput(terminalId, (data) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(encodeTerminalFrame({ type: 'input', data }));
      return true;
    });
    // Resizing the drawer fires this many times a second; one fit per frame keeps the resize frames sent over SSH few.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        fit.fit();
        sendResize();
      });
    });
    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unregister();
      input.dispose();
      socket.close(1000);
      term.dispose();
    };
  }, [terminalId]);

  return (
    // `fill`: in the detail drawer the terminal takes all the height it is given, not a fixed 420px.
    <section className={`flex flex-col rounded border border-hairline bg-well ${fill ? 'min-h-0 flex-1' : 'min-h-[420px]'}`}>
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="font-mono text-sm text-text-primary">{label}</span>
        <span className="flex-1 truncate text-xs text-text-muted">
          {status || 'Thoát khung không tắt agent. Thoát tmux: Ctrl+B rồi D.'}
        </span>
        <button type="button" className="company-btn company-btn-sm company-btn-ghost" onClick={onClose}>
          Đóng
        </button>
      </header>
      <div ref={host} className="min-h-0 flex-1 p-1" />
    </section>
  );
}
