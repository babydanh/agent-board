// What may leave a machine in a snapshot: every omitted file is listed with its reason, never silently dropped.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterSnapshotFiles, MAX_SNAPSHOT_FILE_BYTES } from './snapshotFilter.mjs';

// Token-shaped strings are assembled at run time so this file never holds one literally.
const fakeToken = (prefix, length) => prefix + 'a'.repeat(length);
const file = (path, extra = {}) => ({ path, size: 10, addedText: '', ...extra });

test('TC-SNAPFILTER-01: env files and key files are omitted by name, example files are kept', () => {
  const { keep, omitted } = filterSnapshotFiles([
    file('.env'), file('apps/web/.env.local'), file('keys/server.pem'), file('android/key.properties'), file('.env.example'), file('src/a.ts'),
  ]);
  assert.deepEqual(keep, ['.env.example', 'src/a.ts']);
  assert.deepEqual(omitted.map((o) => o.path), ['.env', 'apps/web/.env.local', 'keys/server.pem', 'android/key.properties']);
  assert.ok(omitted.every((o) => o.reason === 'secret-name'));
});

test('TC-SNAPFILTER-02: a file over the size limit is omitted', () => {
  const { keep, omitted } = filterSnapshotFiles([file('big.bin', { size: MAX_SNAPSHOT_FILE_BYTES + 1 }), file('edge.bin', { size: MAX_SNAPSHOT_FILE_BYTES })]);
  assert.deepEqual(keep, ['edge.bin']);
  assert.deepEqual(omitted, [{ path: 'big.bin', reason: 'too-large' }]);
});

test('TC-SNAPFILTER-03: a token-shaped added line omits the whole file', () => {
  const lines = [
    `const a = "${fakeToken('gh' + 'p_', 36)}"`,
    `key: ${fakeToken('AI' + 'za', 35)}`,
    `id = ${fakeToken('AK' + 'IA', 16).toUpperCase()}`,
    `-----BEGIN RSA PRIV` + `ATE KEY-----`,
  ];
  const { keep, omitted } = filterSnapshotFiles(lines.map((addedText, i) => file(`src/f${i}.ts`, { addedText })));
  assert.deepEqual(keep, []);
  assert.equal(omitted.length, 4);
  assert.ok(omitted.every((o) => o.reason === 'secret-text'));
});

test('TC-SNAPFILTER-04: ordinary code survives and an omission never carries the matched text', () => {
  const secret = fakeToken('gh' + 'p_', 36);
  const { keep, omitted } = filterSnapshotFiles([file('src/ok.ts', { addedText: 'const x = 1;\nreturn x + 2;' }), file('src/leak.ts', { addedText: secret })]);
  assert.deepEqual(keep, ['src/ok.ts']);
  assert.ok(!JSON.stringify(omitted).includes(secret));
});

test('TC-SNAPFILTER-05: a missing list or bad entries are refused, not guessed at', () => {
  assert.deepEqual(filterSnapshotFiles([]), { keep: [], omitted: [] });
  assert.throws(() => filterSnapshotFiles(null), /array/);
  assert.throws(() => filterSnapshotFiles([{ size: 1 }]), /path/);
});
