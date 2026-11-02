// Which ticked branches must not go to staging together (design decision 13). Shared by the board server (before it
// queues anything) and the webview (to disable Start and name the pair), so both always agree.

export interface BlockItem {
  readonly machine: string;
  readonly repo: string;
  readonly branch: string | null;
}

export interface BlockOverlap {
  readonly repo: string;
  readonly machines: readonly string[];
  readonly verdict?: 'conflict' | 'auto' | 'incomplete';
}

export interface BlockingPair<T extends BlockItem> {
  readonly a: T;
  readonly b: T;
  readonly verdict: 'conflict' | 'incomplete';
}

/** Folder, path or host/owner/repo all end in the repository's name; compare that, case-insensitively. */
const repoName = (repo: string): string => repo.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';

/**
 * Pairs of ticked items on different machines whose repository has an overlap with a git verdict of `conflict` or
 * `incomplete` between those machines. Pairs git merges itself (`auto`) or that were never checked pass; a pair is named once,
 * with the worse verdict.
 */
export function blockingPairs<T extends BlockItem>(items: readonly T[], overlaps: readonly BlockOverlap[]): BlockingPair<T>[] {
  const pairs: BlockingPair<T>[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!;
      const b = items[j]!;
      if (a.machine === b.machine || repoName(a.repo) !== repoName(b.repo)) continue;
      const verdicts = overlaps
        .filter((o) => repoName(o.repo) === repoName(a.repo) && o.machines.includes(a.machine) && o.machines.includes(b.machine))
        .map((o) => o.verdict);
      if (verdicts.includes('conflict')) pairs.push({ a, b, verdict: 'conflict' });
      else if (verdicts.includes('incomplete')) pairs.push({ a, b, verdict: 'incomplete' });
    }
  }
  return pairs;
}
