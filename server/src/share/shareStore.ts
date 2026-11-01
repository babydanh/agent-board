/**
 * shareStore: the live "view only" links to terminals, in memory.
 *
 * A link is a random token naming one target (a terminal, a session or a pane); whoever holds it may watch that terminal and
 * nothing else. It lives only here: a board restart ends every link, which is the safe way to
 * fail. A link ends on its own at its deadline or when its owner revokes it, and listeners
 * (the viewer sockets) hear about either at once.
 */

import { randomBytes } from 'node:crypto';

export const SHARE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const SHARE_MIN_TTL_MS = 60 * 1000;
export const SHARE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Links alive at once; each one is an open door, so the number stays small. */
export const SHARE_MAX_ACTIVE = 20;
/** 18 random bytes: 144 bits, 24 url-safe characters. */
const TOKEN_BYTES = 18;

/** What a link shows: a cloud terminal, a board-run omp session, or a herdr pane. */
export type ShareTarget =
  | { readonly kind: 'cloud'; readonly terminalId: number }
  | { readonly kind: 'company'; readonly sessionId: string }
  | { readonly kind: 'herdr'; readonly paneId: string };

export interface Share {
  readonly token: string;
  readonly target: ShareTarget;
  readonly label: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type ShareEndReason = 'revoked' | 'expired';

export class ShareLimitError extends Error {
  constructor() {
    super(`Đã có ${SHARE_MAX_ACTIVE} link đang share: hãy dừng bớt một link rồi thử lại.`);
    this.name = 'ShareLimitError';
  }
}

export interface ShareStoreOptions {
  readonly now?: () => number;
  readonly newToken?: () => string;
}

export class ShareStore {
  readonly #shares = new Map<string, Share>();
  readonly #listeners = new Set<(share: Share, reason: ShareEndReason) => void>();
  readonly #now: () => number;
  readonly #newToken: () => string;

  constructor(options: ShareStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#newToken = options.newToken ?? (() => randomBytes(TOKEN_BYTES).toString('base64url'));
  }

  create(input: { target: ShareTarget; label: string; ttlMs?: number }): Share {
    this.sweep();
    if (this.#shares.size >= SHARE_MAX_ACTIVE) throw new ShareLimitError();
    const ttl = Math.min(Math.max(input.ttlMs ?? SHARE_DEFAULT_TTL_MS, SHARE_MIN_TTL_MS), SHARE_MAX_TTL_MS);
    const createdAt = this.#now();
    const share: Share = { token: this.#newToken(), target: input.target, label: input.label, createdAt, expiresAt: createdAt + ttl };
    this.#shares.set(share.token, share);
    return share;
  }

  /** The live link for this token; an expired one is ended here and reads as absent. */
  get(token: string): Share | undefined {
    const share = this.#shares.get(token);
    if (share === undefined) return undefined;
    if (share.expiresAt <= this.#now()) {
      this.#end(share, 'expired');
      return undefined;
    }
    return share;
  }

  revoke(token: string): boolean {
    const share = this.#shares.get(token);
    if (share === undefined) return false;
    this.#end(share, 'revoked');
    return true;
  }

  /** Active links, newest first. */
  list(): Share[] {
    this.sweep();
    return [...this.#shares.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Ends every link past its deadline. */
  sweep(): void {
    const now = this.#now();
    for (const share of [...this.#shares.values()]) {
      if (share.expiresAt <= now) this.#end(share, 'expired');
    }
  }

  onEnd(listener: (share: Share, reason: ShareEndReason) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #end(share: Share, reason: ShareEndReason): void {
    this.#shares.delete(share.token);
    for (const listener of this.#listeners) listener(share, reason);
  }
}
