/**
 * herdrView: how a herdr agent's status reads on the board, as pure data.
 *
 * herdr reports its own vocabulary (working / blocked / idle / done / unknown).
 * This file maps it to the board's tones once, so the sidebar and the drawer
 * cannot disagree about what "blocked" means.
 */

import type { HerdrAgent } from '../../../core/src/company.js';
import type { HerdrKey, ProjectSessionProgressMessage } from '../../../core/src/messages.js';

export type HerdrTone = 'working' | 'needs' | 'idle' | 'done' | 'unknown';

const TONE_BY_HERDR_STATUS: Readonly<Record<HerdrAgent['status'], HerdrTone>> = {
  working: 'working',
  blocked: 'needs',
  idle: 'idle',
  done: 'done',
  unknown: 'unknown',
};

export function herdrToneFor(status: HerdrAgent['status']): HerdrTone {
  return TONE_BY_HERDR_STATUS[status];
}

export const HERDR_TONE_LABELS: Readonly<Record<HerdrTone, string>> = {
  working: 'đang làm',
  needs: 'chờ bạn',
  idle: 'rảnh',
  done: 'xong',
  unknown: 'không rõ',
};

/** The herdr drawer's two tabs: the live screen, and what the agent is running. */
export type HerdrDrawerTab = 'screen' | 'info';

export const HERDR_DRAWER_TAB_LABELS: Readonly<Record<HerdrDrawerTab, string>> = {
  screen: 'Màn hình',
  info: 'Chi tiết',
};

/** Sort rank: what needs the user first, then what is moving, then the rest. */
export const HERDR_TONE_RANK: Readonly<Record<HerdrTone, number>> = {
  needs: 0,
  working: 1,
  idle: 2,
  done: 3,
  unknown: 4,
};

/** The keys the drawer offers while an agent waits on a choice. */
export const HERDR_CHOICE_KEYS: readonly { key: HerdrKey; label: string }[] = [
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'enter', label: 'Enter' },
  { key: 'esc', label: 'Esc' },
  { key: 'ctrl+c', label: 'Ctrl+C' },
];

/** How long a pane the board just opened or woke may stay out of herdr's list before it counts as gone. */
export const HERDR_START_GRACE_MS = 60_000;

/**
 * What the drawer shows for a pane herdr does not list. A pane the board just started or woke
 * takes a few seconds to appear (the agent is still launching): that is a wait, not a loss.
 */
export function missingPaneView(starting: boolean, elapsedMs: number): { readonly loading: boolean; readonly text: string } {
  if (starting && elapsedMs < HERDR_START_GRACE_MS) {
    return { loading: true, text: 'Đang khởi động phiên trong tab herdr mới…' };
  }
  if (starting) {
    return { loading: false, text: 'Phiên chưa lên sau 1 phút. Xem tab herdr mới mở để biết lỗi, hoặc đánh thức lại.' };
  }
  return { loading: false, text: 'Agent này không còn trong herdr.' };
}

type ProjectSessionStage = ProjectSessionProgressMessage['stage'];

/** Claude Code's permission modes as its footer names them, and how the board words each. */
const PERMISSION_MODES: readonly { readonly footer: RegExp; readonly label: string }[] = [
  { footer: /bypass permissions on/i, label: 'Full quyền' },
  { footer: /auto mode on/i, label: 'Auto' },
  { footer: /accept edits on/i, label: 'Tự nhận sửa' },
  { footer: /plan mode on/i, label: 'Plan' },
];

/** The modes the picker offers, in the order Shift+Tab walks them. `null` is the default mode, which names none. */
export const PERMISSION_MODE_CHOICES: readonly { readonly label: string | null }[] = [
  { label: null },
  { label: 'Tự nhận sửa' },
  { label: 'Plan' },
  { label: 'Auto' },
  { label: 'Full quyền' },
];

/** One lap of Shift+Tab is as many presses as there are modes; more means the mode is not in this session's lap. */
const MODE_SWITCH_MAX_PRESSES = PERMISSION_MODE_CHOICES.length;

/** What to do next on the way to `target`: `current` is the mode the screen shows after `presses` presses so far. */
export function modeSwitchStep(current: string | null, target: string | null, presses: number): 'done' | 'press' | 'give-up' {
  if (current === target) return 'done';
  return presses >= MODE_SWITCH_MAX_PRESSES ? 'give-up' : 'press';
}

/** How many of the screen's last lines are searched: the mode lives in the footer under the input box. */
const PERMISSION_FOOTER_LINES = 6;

/**
 * The permission mode a Claude Code screen shows in its footer ("⏵⏵ bypass permissions on
 * (shift+tab to cycle)"). `null` when none is named, as in the default mode, whose footer lists shortcuts.
 */
export function permissionModeLabel(screenText: string): string | null {
  const footer = screenText.trimEnd().split('\n').slice(-PERMISSION_FOOTER_LINES).join('\n');
  return PERMISSION_MODES.find((mode) => mode.footer.test(footer))?.label ?? null;
}

export interface StartStep {
  readonly label: string;
  readonly state: 'done' | 'active' | 'todo';
}

/** The wait for a herdr tab the board just opened, as steps the user can follow. */
export function paneStartSteps(listed: boolean, hasScreen: boolean): readonly StartStep[] {
  return [
    { label: 'Đã mở tab herdr mới', state: 'done' },
    { label: 'Chờ herdr nhận agent', state: listed ? 'done' : 'active' },
    { label: 'Đọc màn hình đầu tiên', state: hasScreen ? 'done' : listed ? 'active' : 'todo' },
  ];
}

/**
 * The wait inside the new-session dialog: the server makes the worktree, maybe runs the folder's
 * prepare script, then opens the tab. `seen` is what the server has reported so far; the setup step
 * only appears once it reports it, as most folders have no script.
 */
export function sessionRequestSteps(worktreePath: string | null, seen: readonly ProjectSessionStage[]): readonly StartStep[] {
  const steps: readonly { readonly stage: ProjectSessionStage | 'sent'; readonly label: string }[] = [
    { stage: 'sent', label: 'Đã gửi yêu cầu tới máy chủ' },
    { stage: 'worktree', label: worktreePath === null ? 'Mở phiên trong thư mục này' : `Tạo worktree ${worktreePath}` },
    ...(seen.includes('setup') ? [{ stage: 'setup' as const, label: 'Chạy script chuẩn bị worktree' }] : []),
    { stage: 'launch', label: 'Mở tab herdr và chạy CLI' },
  ];
  const current = seen[seen.length - 1] ?? 'worktree';
  const at = steps.findIndex((step) => step.stage === current);
  return steps.map((step, index) => ({ label: step.label, state: index < at ? 'done' : index === at ? 'active' : 'todo' }));
}
