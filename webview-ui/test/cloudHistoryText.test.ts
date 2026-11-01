import { describe, expect, it } from 'vitest';

import { historyToTerminal } from '../src/company/fleet/cloudHistoryText.js';

describe('historyToTerminal', () => {
  it('turns bare newlines into CRLF so a terminal returns to column 0', () => {
    expect(historyToTerminal('a\nb\nc')).toBe('a\r\nb\r\nc');
  });

  it('does not double the CR of text that already has CRLF', () => {
    expect(historyToTerminal('a\r\nb')).toBe('a\r\nb');
  });

  it('drops the trailing blank lines tmux pads a pane with', () => {
    expect(historyToTerminal('a\nb\n\n\n   \n')).toBe('a\r\nb');
  });
});
