// The cloud install copies a fixed list of files; a module the agent imports but the list misses crashes the agent on the machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const here = (name) => new URL(name, import.meta.url);

/** Every local module `agent.mjs` reaches, following relative imports. */
function reachable(entry) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const match of readFileSync(here(name), 'utf8').matchAll(/from '\.\/([\w.-]+\.mjs)'/g)) visit(match[1]);
  };
  visit(entry);
  return [...seen];
}

test('TC-INSTALL-MODULES-01: install-agent.sh copies every module agent.mjs reaches', () => {
  const script = readFileSync(here('install-agent.sh'), 'utf8');
  const listed = script.match(/for f in ([\w -]+); do/)?.[1].split(' ') ?? [];
  const missing = reachable('agent.mjs').filter((name) => !listed.includes(name.replace(/\.mjs$/, '')));
  assert.deepEqual(missing, []);
});
