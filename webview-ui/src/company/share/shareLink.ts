import { SHARE_PAGE_PREFIX } from '../../../../core/src/constants.js';

/** The link a viewer opens, built from whatever address the board itself was opened on. */
export function shareUrl(origin: string, token: string): string {
  return `${origin}${SHARE_PAGE_PREFIX}/${encodeURIComponent(token)}`;
}

/** True when only this machine can open the address, so a link built on it is useless to anyone else. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}
