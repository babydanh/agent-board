import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { TERMINAL_FONT_SIZE_PX, TERMINAL_THEME } from '../../constants.js';
import { CLOUD_HISTORY_SCROLLBACK_LINES, historyToTerminal } from './cloudHistoryText.js';

const TERMINAL_FONT_FAMILY = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace';

/**
 * The scrollback of one cloud session, fetched once and scrolled here. A live scroll costs a network round trip per
 * step (the machine is far away); this view is read-only text already on this computer, so scrolling is instant.
 * It is a snapshot taken when the button was pressed: pressing it again fetches the newer text.
 */
export function CloudHistory({ text, truncated, label, onClose }: { text: string; truncated: boolean; label: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontSize: TERMINAL_FONT_SIZE_PX,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: CLOUD_HISTORY_SCROLLBACK_LINES,
      theme: TERMINAL_THEME,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: 'underline',
      cursorInactiveStyle: 'none',
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    fit.fit();
    term.write(historyToTerminal(text), () => term.scrollToBottom());
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        onClose();
        return false;
      }
      return true;
    });
    term.focus();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        fit.fit();
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      term.dispose();
    };
  }, [text, onClose]);

  return (
    <section className="absolute inset-0 z-10 flex min-h-0 flex-col rounded border border-hairline bg-well">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="font-mono text-sm text-text-primary">Lịch sử · {label}</span>
        <span className="flex-1 truncate text-xs text-text-muted">
          {truncated ? 'Đã cắt phần cũ nhất. ' : ''}Ảnh chụp lúc bấm; cuộn không trễ. Esc để về terminal.
        </span>
        <button type="button" className="company-btn company-btn-sm company-btn-ghost" onClick={onClose}>
          Về terminal
        </button>
      </header>
      <div ref={host} className="min-h-0 flex-1 p-1" />
    </section>
  );
}
