/**
 * Client-message dispatch for view-only share links. Every command needs a privileged connection,
 * and only a cloud terminal can be shared: a link to a local shell would hand a stranger a view of
 * this machine, so those ids are refused no matter what the client sends.
 */

import type { ServerMessage } from '../../../core/src/messages.js';
import { FLEET_TERMINAL_ID_BASE } from '../fleet/constants.js';
import { type Share, ShareLimitError, type ShareStore } from './shareStore.js';

const FALLBACK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
const MS_PER_MINUTE = 60_000;
const MAX_LABEL_LENGTH = 200;

export const SHARE_REASON_READ_ONLY = 'Kết nối chỉ đọc không được phép share session.';
export const SHARE_REASON_NOT_CLOUD = 'Chỉ share được phiên cloud, không share terminal của máy này.';
export const SHARE_REASON_NO_TERMINAL = 'Phiên này không còn chạy nên không share được.';
export const SHARE_REASON_BAD_INPUT = 'Yêu cầu share không hợp lệ.';
export const SHARE_REASON_NO_LINK = 'Link này đã hết hạn hoặc không tồn tại.';

export interface ShareCommandContext {
  readonly shares: ShareStore;
  /** True while the board still holds a terminal with this id. */
  readonly hasTerminal: (terminalId: number) => boolean;
  readonly privileged: boolean;
}

type ShareReply = Extract<ServerMessage, { type: 'shareResult' }>;

function toInfo(share: Share): ShareReply['shares'][number] {
  const { token, terminalId, label, createdAt, expiresAt } = share;
  return { token, terminalId, label, createdAt, expiresAt };
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
  const { terminalId, label, ttlMinutes } = msg;
  const labelText = typeof label === 'string' ? label.trim() : '';
  const ttlValid = ttlMinutes === undefined || (typeof ttlMinutes === 'number' && Number.isFinite(ttlMinutes) && ttlMinutes > 0);
  if (!Number.isInteger(terminalId) || labelText === '' || labelText.length > MAX_LABEL_LENGTH || !ttlValid) {
    reply(false, { reason: SHARE_REASON_BAD_INPUT });
    return;
  }
  const id = terminalId as number;
  if (id <= FLEET_TERMINAL_ID_BASE) {
    reply(false, { reason: SHARE_REASON_NOT_CLOUD });
    return;
  }
  if (!context.hasTerminal(id)) {
    reply(false, { reason: SHARE_REASON_NO_TERMINAL });
    return;
  }
  try {
    const share = context.shares.create({
      terminalId: id,
      label: labelText,
      ...(typeof ttlMinutes === 'number' ? { ttlMs: ttlMinutes * MS_PER_MINUTE } : {}),
    });
    reply(true, { token: share.token });
  } catch (error) {
    if (!(error instanceof ShareLimitError)) throw error;
    reply(false, { reason: error.message });
  }
}

