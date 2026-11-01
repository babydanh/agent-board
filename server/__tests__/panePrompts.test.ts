import { describe, expect, it } from 'vitest';

import { PANE_PROMPTS_MARKER, PANE_PROMPTS_SCRIPT, parsePanePrompts } from '../src/fleet/panePrompts.js';

describe('parsePanePrompts', () => {
  it('groups the prompt lines under the session marker that precedes them', () => {
    const dump = [
      `${PANE_PROMPTS_MARKER} fix-aqp`,
      'P "sửa lỗi stream key"',
      'P "chạy test lại"',
      `${PANE_PROMPTS_MARKER} other`,
      `${PANE_PROMPTS_MARKER} third`,
      'P "một câu"',
    ].join('\n');

    expect(parsePanePrompts(dump)).toEqual(
      new Map([
        ['fix-aqp', ['sửa lỗi stream key', 'chạy test lại']],
        ['third', ['một câu']],
      ]),
    );
  });

  it('skips lines that are not valid JSON strings, text before the first marker and empty prompts', () => {
    const dump = ['warning: tmux', 'P "stray"', `${PANE_PROMPTS_MARKER} s`, 'P not-json', 'P 42', 'P ""', 'P "ok"'].join('\n');

    expect(parsePanePrompts(dump)).toEqual(new Map([['s', ['ok']]]));
  });

  it('keeps at most five prompts and clips each one', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `P "${'x'.repeat(500)}${i}"`);
    const result = parsePanePrompts([`${PANE_PROMPTS_MARKER} s`, ...lines].join('\n'));

    expect(result.get('s')).toHaveLength(5);
    expect(result.get('s')?.every((text) => text.length <= 300)).toBe(true);
  });

  it('returns nothing for an empty dump', () => {
    expect(parsePanePrompts('')).toEqual(new Map());
  });
});

describe('PANE_PROMPTS_SCRIPT', () => {
  it('is a fixed script with no backslash (it travels through a template string into python and bash)', () => {
    expect(PANE_PROMPTS_SCRIPT).not.toContain(String.fromCharCode(92));
    expect(PANE_PROMPTS_SCRIPT).toContain(PANE_PROMPTS_MARKER);
  });
});
