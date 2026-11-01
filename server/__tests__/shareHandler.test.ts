import { describe, expect, it } from 'vitest';

import { handleShareMessage } from '../src/share/handler.js';
import { ShareStore, type ShareTarget } from '../src/share/shareStore.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CLOUD = { kind: 'cloud' as const, terminalId: 900_000_001 };
const REFUSED = 'không share được';

function setup(options: { privileged?: boolean; allow?: (target: ShareTarget) => boolean } = {}) {
  const shares = new ShareStore();
  const allow = options.allow ?? (() => true);
  const sent: Record<string, unknown>[] = [];
  const run = (msg: Record<string, unknown>) =>
    handleShareMessage(msg, (message) => sent.push(message as unknown as Record<string, unknown>), {
      shares,
      targets: { refusal: (target) => (allow(target) ? null : REFUSED) },
      privileged: options.privileged ?? true,
    });
  const create = (extra: Record<string, unknown>) =>
    run({ type: 'shareCreate', requestId: REQUEST_ID, label: 'danh · fix', ...extra });
  return { shares, sent, run, create };
}

describe('handleShareMessage', () => {
  it('TC-SHARE-16 ignores messages that are not share commands', () => {
    const { run, sent } = setup();
    expect(run({ type: 'launchAgent' })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('TC-SHARE-17 creates a cloud link and answers with its token, its kind and the list', () => {
    const { create, sent, shares } = setup();
    expect(create({ kind: 'cloud', terminalId: CLOUD.terminalId, ttlMinutes: 30 })).toBe(true);
    const [reply] = sent;
    expect(reply).toMatchObject({ type: 'shareResult', requestId: REQUEST_ID, ok: true });
    const share = shares.get(reply.token as string)!;
    expect(share).toMatchObject({ target: CLOUD, label: 'danh · fix' });
    expect(share.expiresAt - share.createdAt).toBe(30 * 60_000);
    expect(reply.shares).toEqual([{ token: share.token, kind: 'cloud', label: 'danh · fix', createdAt: share.createdAt, expiresAt: share.expiresAt }]);
  });

  it('TC-SHARE-48 creates links for a board omp session and for a herdr pane', () => {
    const { create, shares } = setup();
    create({ kind: 'company', sessionId: 'session-1' });
    create({ kind: 'herdr', paneId: 'w1:p2' });
    expect(shares.list().map((share) => share.target).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'company', sessionId: 'session-1' },
      { kind: 'herdr', paneId: 'w1:p2' },
    ]);
  });

  it('TC-SHARE-18 refuses a read-only connection and leaves no link behind', () => {
    const { create, sent, shares } = setup({ privileged: false });
    create({ kind: 'cloud', terminalId: CLOUD.terminalId });
    expect(sent[0]).toMatchObject({ type: 'shareResult', ok: false, shares: [] });
    expect(typeof sent[0].reason).toBe('string');
    expect(shares.list()).toEqual([]);
  });

  it('TC-SHARE-19 shows the reason when the target cannot be shared, and makes no link', () => {
    const { create, sent, shares } = setup({ allow: () => false });
    create({ kind: 'cloud', terminalId: 1 });
    create({ kind: 'company', sessionId: 'gone' });
    create({ kind: 'herdr', paneId: 'w9:p9' });
    expect(sent.map((reply) => [reply.ok, reply.reason])).toEqual([[false, REFUSED], [false, REFUSED], [false, REFUSED]]);
    expect(shares.list()).toEqual([]);
  });

  it('TC-SHARE-21 refuses a bad label, lifetime or target shape with a reason instead of throwing', () => {
    const { create, sent } = setup();
    create({ kind: 'cloud', terminalId: CLOUD.terminalId, label: '   ' });
    create({ kind: 'cloud', terminalId: 'nope' });
    create({ kind: 'cloud', terminalId: CLOUD.terminalId, ttlMinutes: -5 });
    create({ kind: 'nothing' });
    create({ kind: 'cloud' });
    create({ kind: 'company', sessionId: '' });
    create({ kind: 'herdr', paneId: 'w1:p1', terminalId: CLOUD.terminalId });
    expect(sent.map((reply) => reply.ok)).toEqual([false, false, false, false, false, false, false]);
  });

  it('TC-SHARE-22 says so at the cap instead of crashing', () => {
    const { create, sent, shares } = setup();
    for (let index = 0; index < 20; index++) shares.create({ target: CLOUD, label: `s${index}` });
    create({ kind: 'cloud', terminalId: CLOUD.terminalId });
    expect(sent[0]).toMatchObject({ ok: false });
    expect(String(sent[0].reason)).toContain('20');
  });

  it('TC-SHARE-23 revokes a link and answers with the list that remains', () => {
    const { run, sent, shares } = setup();
    const { token } = shares.create({ target: CLOUD, label: 'a' });
    shares.create({ target: CLOUD, label: 'b' });
    run({ type: 'shareRevoke', requestId: REQUEST_ID, token });
    expect(sent[0]).toMatchObject({ ok: true });
    expect((sent[0].shares as { label: string }[]).map((share) => share.label)).toEqual(['b']);
    expect(shares.get(token)).toBeUndefined();
  });

  it('TC-SHARE-24 revoking an unknown link is a refusal, not a crash', () => {
    const { run, sent } = setup();
    run({ type: 'shareRevoke', requestId: REQUEST_ID, token: 'a'.repeat(24) });
    expect(sent[0]).toMatchObject({ ok: false });
  });

  it('TC-SHARE-25 lists the live links', () => {
    const { run, sent, shares } = setup();
    shares.create({ target: CLOUD, label: 'a' });
    run({ type: 'shareListRequest', requestId: REQUEST_ID });
    expect(sent[0]).toMatchObject({ type: 'shareResult', ok: true });
    expect(sent[0].shares).toHaveLength(1);
  });
});
