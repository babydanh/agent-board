import { describe, expect, it } from 'vitest';

import { FLEET_TERMINAL_ID_BASE } from '../src/fleet/constants.js';
import { handleShareMessage } from '../src/share/handler.js';
import { ShareStore } from '../src/share/shareStore.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CLOUD_ID = FLEET_TERMINAL_ID_BASE + 1;

function setup(options: { privileged?: boolean; live?: number[] } = {}) {
  const shares = new ShareStore();
  const live = new Set(options.live ?? [CLOUD_ID]);
  const sent: Record<string, unknown>[] = [];
  const run = (msg: Record<string, unknown>) =>
    handleShareMessage(msg, (message) => sent.push(message as unknown as Record<string, unknown>), {
      shares,
      hasTerminal: (id) => live.has(id),
      privileged: options.privileged ?? true,
    });
  return { shares, sent, run };
}

describe('handleShareMessage', () => {
  it('TC-SHARE-16 ignores messages that are not share commands', () => {
    const { run, sent } = setup();
    expect(run({ type: 'launchAgent' })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('TC-SHARE-17 creates a link for a live cloud terminal and answers with its token and the list', () => {
    const { run, sent, shares } = setup();
    expect(run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: 'danh · fix', ttlMinutes: 30 })).toBe(true);
    const [reply] = sent;
    expect(reply).toMatchObject({ type: 'shareResult', requestId: REQUEST_ID, ok: true });
    const token = reply.token as string;
    expect(shares.get(token)).toMatchObject({ terminalId: CLOUD_ID, label: 'danh · fix' });
    expect(reply.shares).toHaveLength(1);
    const share = shares.get(token)!;
    expect(share.expiresAt - share.createdAt).toBe(30 * 60_000);
  });

  it('TC-SHARE-18 refuses a read-only connection and leaves no link behind', () => {
    const { run, sent, shares } = setup({ privileged: false });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: 'x' });
    expect(sent[0]).toMatchObject({ type: 'shareResult', ok: false, shares: [] });
    expect(typeof sent[0].reason).toBe('string');
    expect(shares.list()).toEqual([]);
  });

  it('TC-SHARE-19 never shares a local terminal, whatever its id', () => {
    const { run, sent, shares } = setup({ live: [1, CLOUD_ID] });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: 1, label: 'local shell' });
    expect(sent[0]).toMatchObject({ ok: false });
    expect(shares.list()).toEqual([]);
  });

  it('TC-SHARE-20 refuses a cloud terminal that no longer exists', () => {
    const { run, sent } = setup({ live: [] });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: 'x' });
    expect(sent[0]).toMatchObject({ ok: false });
  });

  it('TC-SHARE-21 refuses a bad label or lifetime with a reason instead of throwing', () => {
    const { run, sent } = setup();
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: '   ' });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: 'nope', label: 'x' });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: 'x', ttlMinutes: -5 });
    expect(sent.map((reply) => reply.ok)).toEqual([false, false, false]);
  });

  it('TC-SHARE-22 says so at the cap instead of crashing', () => {
    const { run, sent, shares } = setup();
    for (let index = 0; index < 20; index++) shares.create({ terminalId: CLOUD_ID, label: `s${index}` });
    run({ type: 'shareCreate', requestId: REQUEST_ID, terminalId: CLOUD_ID, label: 'one more' });
    expect(sent[0]).toMatchObject({ ok: false });
    expect(String(sent[0].reason)).toContain('20');
  });

  it('TC-SHARE-23 revokes a link and answers with the list that remains', () => {
    const { run, sent, shares } = setup();
    const { token } = shares.create({ terminalId: CLOUD_ID, label: 'a' });
    shares.create({ terminalId: CLOUD_ID, label: 'b' });
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
    shares.create({ terminalId: CLOUD_ID, label: 'a' });
    run({ type: 'shareListRequest', requestId: REQUEST_ID });
    expect(sent[0]).toMatchObject({ type: 'shareResult', ok: true });
    expect(sent[0].shares).toHaveLength(1);
  });
});
