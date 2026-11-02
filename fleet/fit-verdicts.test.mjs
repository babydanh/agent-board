// A report carrying verdicts must still fit the hub's body limit; verdicts give way before repository rows do.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitReport } from './agent.mjs';

const verdict = (i) => ({ repo: 'o/r', a: 'danh/a-long-lane-name', b: 'danh1/another-long-lane-name', file: `src/some/deep/folder/file-${i}.ts`.padEnd(300, 'x'), status: 'conflict', ranges: [[1, 2]] });

test('TC-VERDICT-06: too many verdicts are trimmed from the end, and the repository rows stay', () => {
  const repos = [{ path: '/x', branch: 'b', dirty_files: ['a.ts'], changes: [] }];
  const report = fitReport({ agent_id: 'danh', sessions: [], repos, verdicts: Array.from({ length: 200 }, (_, i) => verdict(i)) });
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 60_000);
  assert.ok(report.verdicts.length > 0 && report.verdicts.length < 200);
  assert.equal(report.verdicts[0].file.startsWith('src/some/deep/folder/file-0'), true);
  assert.equal(report.repos.length, 1);
});

test('TC-VERDICT-07: a report with a few verdicts is left untouched', () => {
  const report = { agent_id: 'danh', sessions: [], repos: [], verdicts: [verdict(1)] };
  assert.deepEqual(fitReport(structuredClone(report)), report);
});
