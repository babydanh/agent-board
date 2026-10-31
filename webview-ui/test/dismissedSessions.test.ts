import { describe, expect, it } from 'vitest';

import type { ProjectTreeNode } from '../../core/src/messages.js';
import { dismissEnded, parseDismissed, withoutDismissed } from '../src/company/projects/dismissedSessions.js';

const DAY = 86_400_000;
const session = (id: string, state: string, sessionId?: string): ProjectTreeNode =>
  ({ id, kind: 'session', name: id, state, ...(sessionId === undefined ? {} : { sessionId }) }) as ProjectTreeNode;

describe('dismissEnded', () => {
  it('records each ended session once and leaves running and sleeping ones alone', () => {
    const nodes = [session('a', 'ended', 's1'), session('b', 'ended', 's1'), session('c', 'ended'), session('d', 'running', 's4'), session('e', 'sleeping', 's5')];
    expect(dismissEnded(nodes, {}, 1000)).toEqual({ s1: 1000, c: 1000 });
  });

  it('forgets entries older than three days: the server stops listing those sessions anyway', () => {
    const now = 10 * DAY;
    expect(dismissEnded([session('a', 'ended', 'new')], { old: now - 4 * DAY, recent: now - DAY }, now)).toEqual({ recent: now - DAY, new: now });
  });
});

describe('withoutDismissed', () => {
  it('hides a dismissed ended session', () => {
    const nodes = [session('a', 'ended', 's1'), session('b', 'ended', 's2')];
    expect(withoutDismissed(nodes, { s1: 1 }).map((node) => node.id)).toEqual(['b']);
  });

  it('shows a dismissed session again once it runs again', () => {
    expect(withoutDismissed([session('a', 'running', 's1')], { s1: 1 })).toHaveLength(1);
  });

  it('returns the same array when nothing is dismissed', () => {
    const nodes = [session('a', 'ended', 's1')];
    expect(withoutDismissed(nodes, {})).toBe(nodes);
  });
});

describe('parseDismissed', () => {
  it('reads a stored map and drops anything that is not a number', () => {
    expect(parseDismissed(JSON.stringify({ a: 5, b: 'x', c: null }))).toEqual({ a: 5 });
  });

  it('answers an empty map for missing, broken or non-object storage', () => {
    expect(parseDismissed(null)).toEqual({});
    expect(parseDismissed('{oops')).toEqual({});
    expect(parseDismissed('[1]')).toEqual({});
  });
});
