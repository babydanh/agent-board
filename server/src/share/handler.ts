/**
 * Client-message dispatch for view-only share links. Every command needs a privileged connection,
 * and what may be shared is decided by `targets.refusal`: a link to a local shell would hand a
 * stranger a view of this machine, so only cloud, board-run omp and herdr targets are ever accepted.
 */

import type { ServerMessage } from '../../../core/src/messages.js';
import { type Share, ShareLimitError, type ShareStore, type ShareTarget } from './shareStore.js';
import type { ShareTargets } from './targets.js';

const FALLBACK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
const MS_PER_MINUTE = 60_000;
const MAX_LABEL_LENGTH = 200;
const MAX_REF_LENGTH = 200;

export const SHARE_REASON_READ_ONLY = 'Kết nối chỉ đọc không được phép share session.';
export const SHARE_REASON_BAD_INPUT = 'Yêu cầu share không hợp lệ.';
export const SHARE_REASON_NO_LINK = 'Link này đã hết hạn hoặc không tồn tại.';

export interface ShareCommandContext {
  readonly shares: ShareStore;
  readonly targets: Pick<ShareTargets, 'refusal'>;
  readonly privileged: boolean;
}

type ShareReply = Extract<ServerMessage, { type: 'shareResult' }>;

function toInfo(share: Share): ShareReply['shares'][number] {
  const { token, target, label, createdAt, expiresAt } = share;
  return { token, kind: target.kind, label, createdAt, expiresAt };
}

/** The target a shareCreate names, or null when it does not name exactly one well-formed target. */
function parseTarget(msg: Record<string, unknown>): ShareTarget | null {
  const { kind, terminalId, sessionId, paneId } = msg;
  const text = (value: unknown): value is string =>
    typeof value === 'string' && value !== '' && value.length <= MAX_REF_LENGTH;
  if (kind === 'cloud' && Number.isInteger(terminalId) && sessionId === undefined && paneId === undefined) {
    return { kind, terminalId: terminalId as number };
  }
  if (kind === 'company' && text(sessionId) && terminalId === undefined && paneId === undefined) {
    return { kind, sessionId };
  }
  if (kind === 'herdr' && text(paneId) && terminalId === undefined && sessionId === undefined) {
    return { kind, paneId };
  }
  return null;
}

/** Handles one share command; returns false, without replying, for any other message. */
export function handleShareMessage(
  msg: Record<string, unknown>,
  send: (message: ServerMessage) => void,
  context: ShareCommandContext,
): boolean {
  if (msg.type !== 'shareCreate' && msg.type !== 'shareRevoke' && msg.type !== 'shareListRequest') return false;
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : FALLBACK_REQUEST_ID;
  const reply = (ok: boolean, extra: { reason?: string; token?: string } = {}): void => {
    // A refused command still reports the links as they stand, except to a read-only connection.
    const shares = context.privileged ? context.shares.list().map(toInfo) : [];
    send({ type: 'shareResult', requestId, ok, shares, ...extra });
  };

  if (!context.privileged) {
    reply(false, { reason: SHARE_REASON_READ_ONLY });
    return true;
  }
  if (msg.type === 'shareListRequest') {
    reply(true);
  } else if (msg.type === 'shareRevoke') {
    if (typeof msg.token !== 'string') reply(false, { reason: SHARE_REASON_BAD_INPUT });
    else if (context.shares.revoke(msg.token)) reply(true);
    else reply(false, { reason: SHARE_REASON_NO_LINK });
  } else {
    create(msg, context, reply);
  }
  return true;
}

function create(
  msg: Record<string, unknown>,
  context: ShareCommandContext,
  reply: (ok: boolean, extra?: { reason?: string; token?: string }) => void,
): void {
  const { label, ttlMinutes } = msg;
  const labelText = typeof label === 'string' ? label.trim() : '';
  const ttlValid = ttlMinutes === undefined || (typeof ttlMinutes === 'number' && Number.isFinite(ttlMinutes) && ttlMinutes > 0);
  const target = parseTarget(msg);
  if (target === null || labelText === '' || labelText.length > MAX_LABEL_LENGTH || !ttlValid) {
    reply(false, { reason: SHARE_REASON_BAD_INPUT });
    return;
  }
  const refusal = context.targets.refusal(target);
  if (refusal !== null) {
    reply(false, { reason: refusal });
    return;
  }
  try {
    const share = context.shares.create({
      target,
      label: labelText,
      ...(typeof ttlMinutes === 'number' ? { ttlMs: ttlMinutes * MS_PER_MINUTE } : {}),
    });
    reply(true, { token: share.token });
  } catch (error) {
    if (!(error instanceof ShareLimitError)) throw error;
    reply(false, { reason: error.message });
  }
}
