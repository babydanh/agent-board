import { describe, expect, it } from 'vitest';

import { agentEngineForKind } from '../../core/src/agentEngines.js';

describe('agentEngineForKind (TC-ENGINE-01)', () => {
  it('knows an engine by its id, any case', () => {
    expect(agentEngineForKind('claude')).toBe('claude');
    expect(agentEngineForKind('Agy')).toBe('agy');
  });

  it('reads the ledger display names of an engine, not only its id', () => {
    expect(agentEngineForKind('claude-code')).toBe('claude');
    expect(agentEngineForKind('Claude Code')).toBe('claude');
  });

  it('keeps main and sub as omp, and says nothing about an unknown or missing kind', () => {
    expect(agentEngineForKind('main')).toBe('omp');
    expect(agentEngineForKind('sub')).toBe('omp');
    expect(agentEngineForKind('herdr')).toBeNull();
    expect(agentEngineForKind(null)).toBeNull();
  });

  it('does not take a word that merely starts with an engine id', () => {
    expect(agentEngineForKind('pipeline')).toBeNull();
  });
});
