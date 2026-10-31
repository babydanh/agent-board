// Mux tests: two Mux ends wired back to back in memory.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Mux } from '../lib/mux.js';

const tick = () => new Promise((r) => setTimeout(r, 30));
const within = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))]);
const ended = (stream) => new Promise((resolve) => stream.once('end', resolve));

function pair(onOpen) {
  let a;
  let b;
  a = new Mux((buf) => queueMicrotask(() => b.receive(buf)));
  b = new Mux((buf) => queueMicrotask(() => a.receive(buf)), onOpen);
  return { a, b };
}

describe('Mux', () => {
  it('lets the peer finish its reply after we end our writing side (half close)', async () => {
    const { a, b } = pair((stream) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => stream.end(Buffer.concat(chunks).toString().toUpperCase()));
    });
    const stream = a.open();
    const reply = [];
    stream.on('data', (c) => reply.push(c));
    stream.write('abc');
    stream.end();
    await within(ended(stream), 1000, 'the reply stream to end');
    assert.equal(Buffer.concat(reply).toString(), 'ABC');
    await tick();
    assert.equal(a.size, 0, 'no stream leaks on the opening side');
    assert.equal(b.size, 0, 'no stream leaks on the answering side');
  });

  it('carries payloads larger than one frame in order', async () => {
    const { a } = pair((stream) => stream.pipe(stream));
    const stream = a.open();
    const big = Buffer.alloc(300_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const reply = [];
    stream.on('data', (c) => reply.push(c));
    stream.write(big);
    stream.end();
    await within(ended(stream), 2000, 'echo of the large payload');
    assert.ok(Buffer.concat(reply).equals(big));
  });

  it('closeAll ends every stream on both sides once the channel is gone', async () => {
    const opened = [];
    const { a, b } = pair((stream) => {
      stream.resume(); // a reader is attached, as it is in the real agent
      opened.push(stream);
    });
    const first = a.open();
    const second = a.open();
    await tick();
    assert.equal(b.size, 2);
    a.closeAll();
    await tick();
    assert.equal(a.size, 0);
    assert.equal(b.size, 0, 'the peer is told about each close');
    assert.ok(first.destroyed && second.destroyed);
    assert.ok(opened.every((s) => s.destroyed || s.readableEnded));
  });
});
