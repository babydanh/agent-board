import { describe, expect, it } from 'vitest';

import {
  modeSwitchStep,
  paneStartSteps,
  PERMISSION_MODE_CHOICES,
  permissionModeLabel,
  sessionRequestSteps,
} from '../src/company/herdrView.js';

const FOOTER = ['● Done.', '', '────────────', '❯ ', '────────────'];

describe('permissionModeLabel', () => {
  it('TC-STARTLOG-01 names the mode Claude Code shows in its footer', () => {
    const screen = (footer: string) => [...FOOTER, footer].join('\n');
    expect(permissionModeLabel(screen('  ⏵⏵ bypass permissions on (shift+tab to cycle)'))).toBe('Full quyền');
    expect(permissionModeLabel(screen('  ⏵⏵ auto mode on (shift+tab to cycle)'))).toBe('Auto');
    expect(permissionModeLabel(screen('  ⏵⏵ accept edits on (shift+tab to cycle)'))).toBe('Tự nhận sửa');
    expect(permissionModeLabel(screen('  ⏸ plan mode on (shift+tab to cycle)'))).toBe('Plan');
  });

  it('TC-STARTLOG-02 is null in the default mode, on an empty screen, and for old scrollback', () => {
    expect(permissionModeLabel([...FOOTER, '  ? for shortcuts'].join('\n'))).toBeNull();
    expect(permissionModeLabel('')).toBeNull();
    const old = ['⏵⏵ bypass permissions on', ...Array.from({ length: 10 }, () => 'line')].join('\n');
    expect(permissionModeLabel(old)).toBeNull();
  });
});

describe('start steps', () => {
  it('TC-STARTLOG-03 moves the active step along as the pane is listed and read', () => {
    expect(paneStartSteps(false, false).map((s) => s.state)).toEqual(['done', 'active', 'todo']);
    expect(paneStartSteps(true, false).map((s) => s.state)).toEqual(['done', 'done', 'active']);
    expect(paneStartSteps(true, true).map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });

  it('TC-STARTLOG-04 names the worktree being made, or the shared folder', () => {
    expect(sessionRequestSteps('/r.worktrees/x', [])[1]?.label).toBe('Tạo worktree /r.worktrees/x');
    expect(sessionRequestSteps(null, [])[1]?.label).toBe('Mở phiên trong thư mục này');
  });

  it('TC-STARTLOG-07 follows the stages the server reports, adding the setup step only when it ran', () => {
    const states = (seen: Parameters<typeof sessionRequestSteps>[1]) =>
      sessionRequestSteps('/w', seen).map((step) => `${step.state}:${step.label.split(' ')[0]}`);
    expect(states([])).toEqual(['done:Đã', 'active:Tạo', 'todo:Mở']);
    expect(states(['worktree'])).toEqual(['done:Đã', 'active:Tạo', 'todo:Mở']);
    expect(states(['worktree', 'setup'])).toEqual(['done:Đã', 'done:Tạo', 'active:Chạy', 'todo:Mở']);
    expect(states(['worktree', 'setup', 'launch'])).toEqual(['done:Đã', 'done:Tạo', 'done:Chạy', 'active:Mở']);
    expect(states(['launch'])).toEqual(['done:Đã', 'done:Tạo', 'active:Mở']);
  });
});

describe('permission mode picker', () => {
  it('TC-STARTLOG-08 offers every mode, the default as null, each label once', () => {
    expect(PERMISSION_MODE_CHOICES.map((choice) => choice.label)).toEqual([null, 'Tự nhận sửa', 'Plan', 'Auto', 'Full quyền']);
  });

  it('TC-STARTLOG-09 presses Shift+Tab until the footer matches, and gives up after a full lap', () => {
    expect(modeSwitchStep('Plan', 'Plan', 0)).toBe('done');
    expect(modeSwitchStep(null, null, 0)).toBe('done');
    expect(modeSwitchStep(null, 'Plan', 0)).toBe('press');
    expect(modeSwitchStep('Auto', 'Plan', 4)).toBe('press');
    expect(modeSwitchStep('Auto', 'Plan', 5)).toBe('give-up');
  });
});
