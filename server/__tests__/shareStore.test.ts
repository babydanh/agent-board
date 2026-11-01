import { describe, expect, it, vi } from 'vitest';

import { SHARE_DEFAULT_TTL_MS, SHARE_MAX_ACTIVE, SHARE_MAX_TTL_MS, SHARE_MIN_TTL_MS, ShareLimitError, ShareStore } from '../src/share/shareStore.js';

const cloud = (terminalId: number) => ({ kind: 'cloud' as const, terminalId });

function store(startAt = 1_000_000) {
  const clock = { now: startAt };
  let counter = 0;
  const shares = new ShareStore({ now: () => clock.now, newToken: () => `tok${++counter}` });
  return { shares, clock };
}

describe('ShareStore', () => {
  it('TC-SHARE-01 creates a link that lasts a day by default and is found by its token', () => {
    const { shares, clock } = store();
    const share = shares.create({ target: cloud(7), label: 'danh · fix-login' });
    expect(share).toMatchObject({ token: 'tok1', target: cloud(7), label: 'danh · fix-login', createdAt: clock.now, expiresAt: clock.now + SHARE_DEFAULT_TTL_MS });
    expect(shares.get('tok1')).toEqual(share);
    expect(shares.get('nope')).toBeUndefined();
  });

  it('TC-SHARE-02 clamps a requested lifetime into the allowed range', () => {
    const { shares, clock } = store();
    expect(shares.create({ target: cloud(1), label: 'a', ttlMs: 1 }).expiresAt).toBe(clock.now + SHARE_MIN_TTL_MS);
    expect(shares.create({ target: cloud(1), label: 'b', ttlMs: SHARE_MAX_TTL_MS * 10 }).expiresAt).toBe(clock.now + SHARE_MAX_TTL_MS);
  });

  it('TC-SHARE-03 an expired link is gone: get says nothing, list leaves it out, and the end is announced once', () => {
    const { shares, clock } = store();
    const ended = vi.fn();
    shares.onEnd(ended);
    shares.create({ target: cloud(7), label: 'a' });
    clock.now += SHARE_DEFAULT_TTL_MS;
    expect(shares.get('tok1')).toBeUndefined();
    expect(shares.list()).toEqual([]);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok1' }), 'expired');
  });

  it('TC-SHARE-04 revoking ends the link at once, tells the listeners, and a second revoke is a no-op', () => {
    const { shares } = store();
    const ended = vi.fn();
    shares.onEnd(ended);
    shares.create({ target: cloud(7), label: 'a' });
    expect(shares.revoke('tok1')).toBe(true);
    expect(shares.get('tok1')).toBeUndefined();
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok1' }), 'revoked');
    expect(shares.revoke('tok1')).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('TC-SHARE-05 lists the active links newest first', () => {
    const { shares, clock } = store();
    shares.create({ target: cloud(1), label: 'old' });
    clock.now += 5;
    shares.create({ target: cloud(2), label: 'new' });
    expect(shares.list().map((share) => share.label)).toEqual(['new', 'old']);
  });

  it('TC-SHARE-06 refuses a new link at the cap, but frees room once one expires', () => {
    const { shares, clock } = store();
    for (let index = 0; index < SHARE_MAX_ACTIVE; index++) shares.create({ target: cloud(index), label: `s${index}`, ttlMs: SHARE_MIN_TTL_MS });
    expect(() => shares.create({ target: cloud(99), label: 'one too many' })).toThrow(ShareLimitError);
    clock.now += SHARE_MIN_TTL_MS;
    expect(() => shares.create({ target: cloud(99), label: 'fits now' })).not.toThrow();
  });

  it('TC-SHARE-07 sweep announces every expired link and keeps the rest', () => {
    const { shares, clock } = store();
    const ended = vi.fn();
    shares.onEnd(ended);
    shares.create({ target: cloud(1), label: 'short', ttlMs: SHARE_MIN_TTL_MS });
    shares.create({ target: cloud(2), label: 'long' });
    clock.now += SHARE_MIN_TTL_MS;
    shares.sweep();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(shares.list().map((share) => share.label)).toEqual(['long']);
  });

  it('TC-SHARE-08 default tokens are long, url-safe and never repeat', () => {
    const shares = new ShareStore();
    const tokens = new Set(Array.from({ length: 50 }, (_, index) => {
      const { token } = shares.create({ target: cloud(index), label: 'x' });
      shares.revoke(token);
      return token;
    }));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{24,}$/);
  });
});
