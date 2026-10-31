// Multiplexes many byte streams over one message channel (a WebSocket).
// Frame: [type:1][streamId:4 big-endian][payload]. Only the gateway opens streams; the agent answers them.
import { Duplex } from 'node:stream';

const OPEN = 1;
const DATA = 2;
const CLOSE = 3;
const HEADER = 5;
/** Largest payload per DATA frame, so one big body cannot starve the other streams on the same socket. */
const MAX_CHUNK = 64 * 1024;

function frame(type, id, payload) {
  const size = payload ? payload.length : 0;
  const out = Buffer.allocUnsafe(HEADER + size);
  out[0] = type;
  out.writeUInt32BE(id, 1);
  if (size) payload.copy(out, HEADER);
  return out;
}

export class Mux {
  #send;
  #onOpen;
  #entries = new Map();
  #nextId = 1;

  /** send(buffer): best-effort write to the channel (must not throw). onOpen(stream): a stream the peer opened. */
  constructor(send, onOpen) {
    this.#send = send;
    this.#onOpen = onOpen;
  }

  /** Open a stream to the peer; it behaves like a connected socket, so http.request can use it as its connection. */
  open() {
    const id = this.#nextId++;
    const { stream } = this.#make(id);
    this.#send(frame(OPEN, id));
    return stream;
  }

  /** Feed one channel message in. */
  receive(buf) {
    if (buf.length < HEADER) return;
    const type = buf[0];
    const id = buf.readUInt32BE(1);
    if (type === OPEN) {
      const { stream } = this.#make(id);
      this.#onOpen?.(stream);
      return;
    }
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (type === DATA) {
      entry.stream.push(buf.subarray(HEADER));
    } else if (type === CLOSE) {
      // The peer will send no more. Ending our reading side also ends our writing side (allowHalfOpen: false), which
      // sends our own CLOSE; the entry is dropped once both CLOSEs have crossed.
      entry.received = true;
      entry.stream.push(null);
      entry.release();
    }
  }

  /** The channel is gone: end every stream. */
  closeAll() {
    for (const entry of [...this.#entries.values()]) entry.stream.destroy();
  }

  get size() {
    return this.#entries.size;
  }

  #make(id) {
    const mux = this;
    const entry = { stream: null, sent: false, received: false, release: null };
    // Each side sends CLOSE exactly once, when its writing side ends; closing is half-duplex until both have.
    const sendClose = () => {
      if (entry.sent) return;
      entry.sent = true;
      mux.#send(frame(CLOSE, id));
    };
    entry.release = () => {
      if (entry.sent && entry.received) mux.#entries.delete(id);
    };
    const stream = new Duplex({
      allowHalfOpen: false,
      read() {},
      write(chunk, _encoding, cb) {
        for (let at = 0; at < chunk.length; at += MAX_CHUNK) mux.#send(frame(DATA, id, chunk.subarray(at, at + MAX_CHUNK)));
        cb();
      },
      final(cb) {
        sendClose();
        entry.release();
        cb();
      },
      destroy(err, cb) {
        sendClose();
        mux.#entries.delete(id);
        cb(err);
      },
    });
    // http.request calls these on its connection; a tunnel stream has nothing to tune.
    stream.setNoDelay = () => stream;
    stream.setKeepAlive = () => stream;
    stream.setTimeout = () => stream;
    stream.ref = () => stream;
    stream.unref = () => stream;
    entry.stream = stream;
    this.#entries.set(id, entry);
    return entry;
  }
}
