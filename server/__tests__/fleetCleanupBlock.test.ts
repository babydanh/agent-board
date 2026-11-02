import { describe, expect, it } from 'vitest';

import { blockingPairs } from '../../core/src/cleanupBlock.js';

const item = (machine: string, branch: string, repo = '/data/home/shop') => ({ machine, repo, branch });
const overlap = (machines: string[], verdict?: 'conflict' | 'auto' | 'incomplete', repo = 'shop') => ({ repo, machines, ...(verdict ? { verdict } : {}) });

describe('blockingPairs', () => {
  it('names a ticked pair whose git verdict is conflict or incomplete (design decision 13)', () => {
    const items = [item('danh', 'feat/a'), item('danh1', 'feat/b'), item('danh2', 'feat/c')];
    expect(blockingPairs(items, [overlap(['danh', 'danh1'], 'conflict')])).toEqual([{ a: items[0], b: items[1], verdict: 'conflict' }]);
    expect(blockingPairs(items, [overlap(['danh1', 'danh2'], 'incomplete')])).toEqual([{ a: items[1], b: items[2], verdict: 'incomplete' }]);
  });

  it('a conflict outranks an incomplete verdict for the same pair, and a pair is named once', () => {
    const items = [item('danh', 'feat/a'), item('danh1', 'feat/b')];
    const pairs = blockingPairs(items, [overlap(['danh', 'danh1'], 'incomplete'), overlap(['danh', 'danh1'], 'conflict'), overlap(['danh', 'danh1'], 'conflict')]);
    expect(pairs).toEqual([{ a: items[0], b: items[1], verdict: 'conflict' }]);
  });

  it('lets through pairs git merges by itself, pairs with no verdict, other repositories and unticked machines', () => {
    const items = [item('danh', 'feat/a'), item('danh1', 'feat/b')];
    expect(blockingPairs(items, [overlap(['danh', 'danh1'], 'auto')])).toEqual([]);
    expect(blockingPairs(items, [overlap(['danh', 'danh1'])])).toEqual([]);
    expect(blockingPairs(items, [overlap(['danh', 'danh1'], 'conflict', 'other-repo')])).toEqual([]);
    expect(blockingPairs(items, [overlap(['danh', 'danh9'], 'conflict')])).toEqual([]);
  });

  it('matches a repository by its last path segment, whatever the form (folder, path or host/owner/repo)', () => {
    const items = [item('danh', 'feat/a', '/data/home/Shop'), item('danh1', 'feat/b', 'C:\\work\\shop')];
    expect(blockingPairs(items, [overlap(['danh', 'danh1'], 'conflict', 'github.com/acme/shop')])).toHaveLength(1);
  });

  it('with fewer than two items nothing can block', () => {
    expect(blockingPairs([item('danh', 'feat/a')], [overlap(['danh', 'danh1'], 'conflict')])).toEqual([]);
    expect(blockingPairs([], [])).toEqual([]);
  });
});
