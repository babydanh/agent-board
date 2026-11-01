import { describe, expect, it } from 'vitest';

import { askedQuestion, parsePanePeek, screenAsksUser } from '../src/fleet/paneAsk.js';

const PERMISSION_MENU = [
  '● Running git log --oneline -1',
  '──────────────────────────────────────────────',
  ' Read outside the working directories',
  ' Allow this read outside the working directories?',
  ' ❯ 1. Yes, and keep allowing any reads outside the working directories',
  '   2. No, and block reads outside the working directories from now on',
  '   3. No, and ask again next time',
  ' Esc to cancel · Tab to amend',
].join('\n');

const QUESTION_MENU = [
  '● Which database should the report use?',
  ' ❯ 1. Postgres',
  '   2. SQLite',
  ' Enter to select · ↑/↓ to navigate · Esc to cancel',
].join('\n');

const IDLE_PROMPT = ['● Done. The report is written.', '', '────────────', '❯ ', '────────────', '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n');

describe('screenAsksUser', () => {
  it('recognises a permission menu and a question menu', () => {
    expect(screenAsksUser(PERMISSION_MENU)).toBe(true);
    expect(screenAsksUser(QUESTION_MENU)).toBe(true);
  });

  it('does not take an idle prompt or a numbered list in the answer for a question', () => {
    expect(screenAsksUser(IDLE_PROMPT)).toBe(false);
    expect(screenAsksUser('Steps:\n1. install\n2. build\n3. run')).toBe(false);
    expect(screenAsksUser('')).toBe(false);
  });

  it('ignores the blank rows under a menu that sits high on a mostly empty screen', () => {
    expect(screenAsksUser(`${PERMISSION_MENU}${'\n'.repeat(40)}`)).toBe(true);
  });

  it('only looks at the bottom of the screen: a menu long answered and scrolled up is not asking', () => {
    const scrolled = `${PERMISSION_MENU}\n${Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')}`;
    expect(screenAsksUser(scrolled)).toBe(false);
  });
});

describe('askedQuestion', () => {
  it('TC-CLOUD-ASK-01 reads the question above the options, then the options', () => {
    expect(askedQuestion(QUESTION_MENU)).toBe('Which database should the report use? — 1. Postgres / 2. SQLite');
    expect(askedQuestion(PERMISSION_MENU)).toBe(
      'Allow this read outside the working directories? — 1. Yes, and keep allowing any reads outside the working directories / 2. No, and block reads outside the working directories from now on / 3. No, and ask again next time',
    );
  });

  it('TC-CLOUD-ASK-02 is null for no menu, and falls back to the options when nothing is above them', () => {
    expect(askedQuestion(IDLE_PROMPT)).toBeNull();
    expect(askedQuestion('1. Yes\n2. No\nEnter to select')).toBe('1. Yes / 2. No');
  });

  it('TC-CLOUD-ASK-03 never returns more than 300 characters', () => {
    const long = ['x'.repeat(500), ' ❯ 1. Yes', ' Esc to cancel'].join('\n');
    expect(askedQuestion(long)?.length).toBe(300);
  });
});

describe('parsePanePeek', () => {
  it('splits the dump per session and keeps only the sessions that ask, with their question', () => {
    const dump = ['@@BOARD-PEEK@@ fix-aqp', PERMISSION_MENU, '@@BOARD-PEEK@@ audit-aqp', IDLE_PROMPT, '@@BOARD-PEEK@@ other', QUESTION_MENU].join('\n');
    const asking = parsePanePeek(dump);
    expect([...asking.keys()].sort()).toEqual(['fix-aqp', 'other']);
    expect(asking.get('other')).toContain('Which database should the report use?');
  });

  it('returns nothing for noise before the first marker or an empty dump', () => {
    expect(parsePanePeek('warning: something\n').size).toBe(0);
    expect(parsePanePeek('').size).toBe(0);
  });
});
