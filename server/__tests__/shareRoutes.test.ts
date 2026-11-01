/**
 * The share viewer: a link opens one terminal, read-only, and nothing else.
 * Real server and real WebSocket client; the terminal is a fake feed.
 */

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { parseServerFrame, type TerminalServerFrame } from '../../core/src/terminalFrames.js';
import { WS_CLOSE_FORBIDDEN_ORIGIN, WS_CLOSE_NO_SESSION, WS_CLOSE_SHARE_ENDED, WS_CLOSE_SHARE_FULL, WS_CLOSE_SHARE_UNKNOWN } from '../src/constants.js';
import { registerShareRoutes, SHARE_MAX_VIEWERS, type ShareFeed } from '../src/share/shareRoutes.js';
import { ShareStore } from '../src/share/shareStore.js';

const cloud = (terminalId: number) => ({ kind: 'cloud' as const, terminalId });

class FakeFeed implements ShareFeed {
  cols = 100;
  rows = 30;
  received: string[] = [];
  #data = new Set<(chunk: string) => void>();
  #exit = new Set<(exit: { exitCode: number }) => void>();
  snapshot(): Promise<string> {
    return Promise.resolve('SCREEN');
  }
  onData(listener: (chunk: string) => void): () => void {
    this.#data.add(listener);
    return () => this.#data.delete(listener);
  }
  onExit(listener: (exit: { exitCode: number }) => void): () => void {
    this.#exit.add(listener);
    return () => this.#exit.delete(listener);
  }
  emit(chunk: string): void {
    for (const listener of this.#data) listener(chunk);
  }
  end(exitCode: number): void {
    for (const listener of this.#exit) listener({ exitCode });
  }
  listeners(): number {
    return this.#data.size;
  }
}

let app: FastifyInstance | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await app?.close();
  app = undefined;
});

async function start(feeds: Map<number, FakeFeed>) {
  const shares = new ShareStore();
  app = Fastify();
  await app.register(fastifyWebsocket);
  registerShareRoutes(app, { shares, feedFor: (target) => (target.kind === 'cloud' ? feeds.get(target.terminalId) : undefined) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { shares, port };
}

interface Viewer {
  frames: TerminalServerFrame[];
  closed: Promise<number>;
  socket: WebSocket;
}

function watch(port: number, token: string, headers: Record<string, string> = {}): Viewer {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/share-ws/${token}`, { headers });
  sockets.push(socket);
  const frames: TerminalServerFrame[] = [];
  socket.on('message', (data) => {
    const frame = parseServerFrame(data.toString());
    if (frame) frames.push(frame);
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  socket.on('error', () => undefined);
  return { frames, closed, socket };
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 100 && !condition(); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(condition()).toBe(true);
};

describe('share viewer page', () => {
  it('TC-SHARE-09 serves the page for a live link with the label escaped and no-store, no-referrer, noindex headers', async () => {
    const { shares, port } = await start(new Map([[7, new FakeFeed()]]));
    const { token } = shares.create({ target: cloud(7), label: '<b>danh</b> · fix' });
    const response = await fetch(`http://127.0.0.1:${port}/share/${token}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('&#60;b&#62;danh&#60;/b&#62; · fix');
    expect(html).not.toContain('<b>danh</b>');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('TC-SHARE-10 answers a revoked, unknown or malformed link with the same 404', async () => {
    const { shares, port } = await start(new Map([[7, new FakeFeed()]]));
    const { token } = shares.create({ target: cloud(7), label: 'a' });
    shares.revoke(token);
    for (const path of [`/share/${token}`, '/share/aaaaaaaaaaaaaaaaaaaaaaaa']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(404);
    }
    expect((await fetch(`http://127.0.0.1:${port}/share/x`)).status).toBe(400);
  });
});

describe('share viewer socket', () => {
  it('TC-SHARE-11 sends the screen first, then the live output, then the exit', async () => {
    const feed = new FakeFeed();
    const { shares, port } = await start(new Map([[7, feed]]));
    const { token } = shares.create({ target: cloud(7), label: 'a' });
    const viewer = watch(port, token);
    await until(() => viewer.frames.length === 1);
    expect(viewer.frames[0]).toEqual({ type: 'replay', data: 'SCREEN', cols: 100, rows: 30 });
    feed.emit('hello');
    feed.end(3);
    await until(() => viewer.frames.length === 3);
    expect(viewer.frames.slice(1)).toEqual([{ type: 'output', data: 'hello' }, { type: 'exit', exitCode: 3 }]);
  });

  it('TC-SHARE-12 never lets a viewer write, resize or otherwise reach the terminal', async () => {
    const feed = new FakeFeed();
    const { shares, port } = await start(new Map([[7, feed]]));
    const { token } = shares.create({ target: cloud(7), label: 'a' });
    const viewer = watch(port, token);
    await until(() => viewer.frames.length === 1);
    viewer.socket.send(JSON.stringify({ type: 'input', data: 'rm -rf /\n' }));
    viewer.socket.send(JSON.stringify({ type: 'resize', cols: 1, rows: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The feed has no write or resize at all, and the viewer stays connected and gets nothing back.
    expect(Object.keys(feed)).not.toContain('write');
    expect(viewer.frames).toHaveLength(1);
    expect(viewer.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('TC-SHARE-13 closes at once when the link is revoked while watching', async () => {
    const { shares, port } = await start(new Map([[7, new FakeFeed()]]));
    const { token } = shares.create({ target: cloud(7), label: 'a' });
    const viewer = watch(port, token);
    await until(() => viewer.frames.length === 1);
    shares.revoke(token);
    expect(await viewer.closed).toBe(WS_CLOSE_SHARE_ENDED);
  });

  it('TC-SHARE-14 refuses an unknown link, a link whose terminal is gone, a foreign origin and a full link', async () => {
    const feed = new FakeFeed();
    const { shares, port } = await start(new Map([[7, feed]]));
    expect(await watch(port, 'aaaaaaaaaaaaaaaaaaaaaaaa').closed).toBe(WS_CLOSE_SHARE_UNKNOWN);
    const orphan = shares.create({ target: cloud(99), label: 'gone' });
    expect(await watch(port, orphan.token).closed).toBe(WS_CLOSE_NO_SESSION);
    const live = shares.create({ target: cloud(7), label: 'a' });
    expect(await watch(port, live.token, { Origin: 'http://evil.example' }).closed).toBe(WS_CLOSE_FORBIDDEN_ORIGIN);

    const watchers = Array.from({ length: SHARE_MAX_VIEWERS }, () => watch(port, live.token));
    await until(() => watchers.every((viewer) => viewer.frames.length === 1));
    expect(await watch(port, live.token).closed).toBe(WS_CLOSE_SHARE_FULL);
  });

  it('TC-SHARE-15 stops listening to the terminal once the viewer leaves', async () => {
    const feed = new FakeFeed();
    const { shares, port } = await start(new Map([[7, feed]]));
    const { token } = shares.create({ target: cloud(7), label: 'a' });
    const viewer = watch(port, token);
    await until(() => feed.listeners() === 1);
    viewer.socket.close();
    await until(() => feed.listeners() === 0);
  });
});
