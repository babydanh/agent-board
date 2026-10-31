// The tunnel agent: dials OUT to the relay and answers each stream the relay opens with a TCP connection to the local board.
import net from 'node:net';

import { Mux } from './mux.js';

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const OPEN = 1;

/** Returns { connected: Promise<boolean>, stop() }. `connected` resolves true once the relay accepts the hello. */
export function startAgent({ relayUrl, secret, boardPort, boardHost = '127.0.0.1', name, priority = 0, boardToken, reconnect = true, log = () => {} }) {
  let stopped = false;
  let ws = null;
  let timer = null;
  let delay = MIN_DELAY_MS;
  let resolveConnected;
  const connected = new Promise((resolve) => {
    resolveConnected = resolve;
  });

  function connect() {
    const socket = new WebSocket(relayUrl);
    ws = socket;
    socket.binaryType = 'arraybuffer';
    const mux = new Mux(
      (buf) => {
        if (socket.readyState === OPEN) socket.send(buf);
      },
      (stream) => {
        const local = net.connect(boardPort, boardHost);
        stream.pipe(local);
        local.pipe(stream);
        const end = () => {
          local.destroy();
          stream.destroy();
        };
        local.on('error', end);
        stream.on('error', end);
        stream.on('close', end);
      },
    );
    socket.onopen = () => socket.send(JSON.stringify({ hello: { secret, name, priority, boardToken } }));
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          if (JSON.parse(event.data).ready) {
            delay = MIN_DELAY_MS;
            log(`[relay-agent] connected as "${name}"`);
            resolveConnected(true);
          }
        } catch {
          // A malformed control message is ignored; the relay drops us if the hello was refused.
        }
        return;
      }
      mux.receive(Buffer.from(event.data));
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      mux.closeAll();
      if (stopped || !reconnect) return;
      log(`[relay-agent] disconnected, retrying in ${delay / 1000}s`);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    };
  }

  connect();
  return {
    connected,
    stop() {
      stopped = true;
      clearTimeout(timer);
      resolveConnected(false);
      ws?.close();
    },
  };
}
