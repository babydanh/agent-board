// Decides which files of a lane may go into a snapshot pushed to GitHub. Patterns are copied from
// ~/.omp/scripts/backup-push.py (SECRET_NAME, SECRET_EXAMPLE, SECRET_TEXT, MAX_BYTES): keep the two in step.
// Character classes such as `gh[p]_` keep this file itself free of the literals a secret scan looks for.

export const MAX_SNAPSHOT_FILE_BYTES = 50 * 1024 * 1024;

const SECRET_NAME = /(^|\/)(\.env(\..+)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_rsa.*|credentials.*\.json|service-account.*\.json|key\.properties)$/i;
const EXAMPLE_NAME = /\.(example|sample|template)$/i;
const SECRET_TEXT = new RegExp([
  'gh[p]_[A-Za-z0-9]{36}',
  'github_p[a]t_[A-Za-z0-9_]{60,}',
  's[k]-(or-v1-)?[A-Za-z0-9]{32,}',
  'AKI[A][0-9A-Z]{16}',
  'AIz[a][0-9A-Za-z_-]{35}',
  '-----BEGIN [A-Z ]*PRIVATE[ ]KEY-----',
  'xox[bp]-[A-Za-z0-9-]{20,}',
].join('|'));

/**
 * @param {{ path: string, size: number, addedText: string }[]} files the lane's changed files (addedText = added lines)
 * @returns {{ keep: string[], omitted: { path: string, reason: 'secret-name' | 'too-large' | 'secret-text' }[] }}
 * An omission names the file and the reason only, never the text that matched.
 */
export function filterSnapshotFiles(files) {
  if (!Array.isArray(files)) throw new Error('files must be an array');
  const keep = [];
  const omitted = [];
  for (const entry of files) {
    if (typeof entry?.path !== 'string' || entry.path === '') throw new Error('every file needs a path');
    const reason = omissionReason(entry);
    if (reason) omitted.push({ path: entry.path, reason });
    else keep.push(entry.path);
  }
  return { keep, omitted };
}

function omissionReason({ path, size, addedText }) {
  if (SECRET_NAME.test(path) && !EXAMPLE_NAME.test(path)) return 'secret-name';
  if (size > MAX_SNAPSHOT_FILE_BYTES) return 'too-large';
  if (SECRET_TEXT.test(addedText ?? '')) return 'secret-text';
  return null;
}
