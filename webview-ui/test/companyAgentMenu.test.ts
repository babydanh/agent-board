import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isReplayableClientMessage } from '../../core/src/messageDelivery.js';
import type { ProjectTreeNode } from '../../core/src/messages.js';
import {
  type AgentMenuItem,
  type AgentMenuSubject,
  agentMenuTriggers,
  herdrMenuItems,
  herdrNameProblem,
  MENU_MARGIN_PX,
  type MenuTarget,
  placeMenu,
  planningMenuItems,
  projectMenuItems,
  projectNodeMenuItems,
  type SessionMenuFacts,
  sessionMenuItems,
  sessionNameProblem,
  sleepingMenuItems,
  squadRunMenuItems,
  taskCardMenuItems,
  workItemCardMenuItems,
} from '../src/company/agentMenu.js';
import { copyText } from '../src/company/clipboard.js';
import {
  herdrClose,
  herdrInfoRequest,
  herdrRename,
  isCompanyServerMessage,
  sessionInfoRequest,
  sessionRename,
} from '../src/company/companyMessages.js';
import { HOLDS_WORK_REASON } from '../src/company/sessionActions.js';

/** True when every danger item sits after the rest, so the menu ends in its red items. */
function dangerIsSuffix(items: readonly AgentMenuItem[]): boolean {
  const firstDanger = items.findIndex((entry) => entry.danger);
  return firstDanger === -1 || items.slice(firstDanger).every((entry) => entry.danger);
}

const BUSY_SESSION: SessionMenuFacts = {
  status: 'busy',
  cwd: '/work',
  holdsWork: false,
  work: { folder: '/work', privileged: true },
};

describe('sessionMenuItems', () => {
  it('lists the session actions, the controls its status allows, then the danger items', () => {
    const items = sessionMenuItems(BUSY_SESSION, null);

    expect(items.map((item) => item.label)).toEqual([
      'Đổi tên…',
      'Sao chép mã phiên',
      'Sao chép thư mục làm việc',
      'Mở Terminal',
      'Mở Hoạt động',
      'Mở Việc',
      'Mở Chi tiết',
      'Giao việc cho agent này…',
      'Mô tả vai trò…',
      'Dừng lượt',
      'Tạm dừng',
      'Tắt phiên',
      'Xoá phiên…',
    ]);
  });

  it('offers resume and restart for a parked session; delete is listed for every status', () => {
    const parked = sessionMenuItems({ ...BUSY_SESSION, status: 'parked' }, null);
    expect(
      parked.filter((item) => item.action.kind === 'control').map((item) => item.label),
    ).toEqual(['Tiếp tục', 'Khởi động lại', 'Xoá phiên…']);

    const archived = sessionMenuItems({ ...BUSY_SESSION, status: 'archived' }, null);
    expect(
      archived.filter((item) => item.action.kind === 'control').map((item) => item.label),
    ).toEqual(['Xoá phiên…']);
  });

  it('maps each control to its action and keeps kill and delete as the danger items', () => {
    const items = sessionMenuItems(BUSY_SESSION, null);

    expect(items.find((item) => item.label === 'Dừng lượt')).toMatchObject({
      danger: false,
      action: { kind: 'control', action: 'interrupt' },
    });
    expect(items.find((item) => item.label === 'Tắt phiên')).toMatchObject({
      danger: true,
      action: { kind: 'control', action: 'kill' },
    });
    expect(items.find((item) => item.label === 'Xoá phiên…')).toMatchObject({
      danger: true,
      action: { kind: 'control', action: 'delete' },
    });
    expect(items.filter((item) => item.danger).map((item) => item.label)).toEqual([
      'Tắt phiên',
      'Xoá phiên…',
    ]);
    expect(dangerIsSuffix(items)).toBe(true);
  });

  it('opens a group at the log tabs, the first control and the danger items', () => {
    const items = sessionMenuItems(BUSY_SESSION, null);

    expect(items.filter((item) => item.startsGroup).map((item) => item.label)).toEqual([
      'Mở Terminal',
      'Giao việc cho agent này…',
      'Dừng lượt',
      'Tắt phiên',
    ]);
  });

  it('offers maximize only from a drawer header, labelled for the drawer state', () => {
    const open = sessionMenuItems(BUSY_SESSION, { maximized: false });
    expect(open.find((item) => item.label === 'Phóng to')?.action).toEqual({ kind: 'maximize' });

    const maximized = sessionMenuItems(BUSY_SESSION, { maximized: true });
    expect(maximized.some((item) => item.label === 'Thu nhỏ')).toBe(true);
    expect(open.find((item) => item.label === 'Phóng to')?.icon).toBe('maximize');
    expect(maximized.find((item) => item.label === 'Thu nhỏ')?.icon).toBe('minimize');

    const fromSidebar = sessionMenuItems(BUSY_SESSION, null);
    expect(fromSidebar.some((item) => item.action.kind === 'maximize')).toBe(false);
  });

  it('offers interrupt only while a turn runs', () => {
    const idle = sessionMenuItems({ ...BUSY_SESSION, status: 'idle' }, null);
    expect(idle.some((item) => item.label === 'Dừng lượt')).toBe(false);

    const busy = sessionMenuItems(BUSY_SESSION, null);
    expect(busy.some((item) => item.label === 'Dừng lượt')).toBe(true);
  });

  it('refuses delete with its hint and reason while the session holds work', () => {
    const items = sessionMenuItems({ ...BUSY_SESSION, holdsWork: true }, null);

    expect(items.find((item) => item.id === 'control-delete')).toMatchObject({
      disabled: true,
      hint: 'đang giữ việc',
      title: HOLDS_WORK_REASON,
    });
  });

  it('enables delete for a session that holds no work', () => {
    const items = sessionMenuItems({ ...BUSY_SESSION, status: 'parked' }, null);

    expect(items.find((item) => item.id === 'control-delete')).toMatchObject({
      disabled: false,
      hint: null,
    });
  });

  it('omits the folder copy when the session has no folder', () => {
    const items = sessionMenuItems({ ...BUSY_SESSION, cwd: null }, null);

    expect(items.some((item) => item.label === 'Sao chép thư mục làm việc')).toBe(false);
    expect(items.find((item) => item.id === 'copy-code')).toMatchObject({ disabled: false });
  });
});

describe('herdr project session menu', () => {
  const node = (agentKind: ProjectTreeNode['agentKind'], state: string): ProjectTreeNode => ({
    id: 'pane',
    kind: 'session',
    name: 'pane',
    sessionId: 'w1:p2',
    agentKind,
    state,
  });

  it('TC-SHARE-35 offers "Share session…" on a cloud session that is awake, never on a sleeping or a local one', () => {
    const cloudSession = (state: string): ProjectTreeNode => ({ id: 'cloud:m1/fix-login', kind: 'session', name: 'fix-login', state });
    const share = (target: ProjectTreeNode) =>
      projectNodeMenuItems(target, { hasCheckout: false, folderCount: 1, cloud: true }).find((item) => item.id === 'share');
    expect(share(cloudSession('working'))?.action).toEqual({ kind: 'projectNodeAction', action: 'share' });
    expect(share(cloudSession('sleeping'))).toBeUndefined();
    expect(share({ id: 'omp:abc', kind: 'session', name: 'local', sessionId: 'abc', agentKind: 'omp', state: 'working' })).toBeUndefined();
  });

  it('offers a Claude and an omp cloud session next to the local ones, only when the cloud page exists', () => {
    const folder: ProjectTreeNode = { id: 'f', kind: 'folder', name: 'f', path: 'V:/f' };
    const labels = (cloud: boolean) =>
      projectNodeMenuItems(folder, { hasCheckout: false, folderCount: 1, cloud }).map((item) => item.label);
    expect(labels(false).some((label) => label.includes('cloud'))).toBe(false);
    expect(labels(true).filter((label) => label.includes('cloud'))).toEqual(['Phiên mới · Claude cloud', 'Phiên mới · omp cloud']);
    const items = projectNodeMenuItems(folder, { hasCheckout: false, folderCount: 1, cloud: true });
    expect(items.find((item) => item.label === 'Phiên mới · omp cloud')?.action).toEqual({ kind: 'projectNodeAction', action: 'newCloudOmp' });
    expect(items.find((item) => item.label === 'Phiên mới · Claude cloud')?.action).toEqual({ kind: 'projectNodeAction', action: 'newCloudClaude' });
    // The board only opens omp, Claude and agy itself.
    expect(items.filter((item) => /^Phiên mới · (Codex|pi|ThinkRail)$/.test(item.label))).toEqual([]);
  });

  it('offers pane deletion for sleeping and awake herdr sessions only', () => {
    for (const state of ['sleeping', 'idle']) {
      const items = projectNodeMenuItems(node('herdr', state));
      expect(items.find((item) => item.label === 'Xoá phiên…')).toMatchObject({
        danger: true,
        action: { kind: 'projectNodeAction', action: 'closeHerdr' },
      });
    }

    expect(projectNodeMenuItems(node('omp', 'idle')).some((item) => item.label === 'Xoá phiên…')).toBe(false);
  });
});

describe('taskCardMenuItems', () => {
  it("puts the task's own items first and the session's after a group break", () => {
    const items = taskCardMenuItems({ code: 'T1', contractId: 'c1' }, BUSY_SESSION, {
      maximized: false,
    });

    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      'Xem chi tiết',
      'Xem Contract',
      'Sao chép mã việc',
    ]);
    expect(items[3]).toMatchObject({ label: 'Đổi tên…', startsGroup: true });
  });

  it('offers no Contract item when the board holds no Contract for the task', () => {
    const items = taskCardMenuItems({ code: 'T1', contractId: null }, null, null);

    expect(items.some((item) => item.label === 'Xem Contract')).toBe(false);
  });

  it('offers only its own items and maximize for a task with no session', () => {
    const items = taskCardMenuItems({ code: 'T1', contractId: null }, null, { maximized: false });

    expect(items.map((item) => item.label)).toEqual([
      'Xem chi tiết',
      'Sao chép mã việc',
      'Phóng to',
    ]);
    expect(items[2]).toMatchObject({ startsGroup: true });
  });
});

describe('planningMenuItems', () => {
  it('offers only the cancel, as a danger item, for a prompt with no session', () => {
    const items = planningMenuItems(false);

    expect(items.map((item) => item.label)).toEqual(['Huỷ prompt này…']);
    expect(items[0]).toMatchObject({ danger: true, startsGroup: false });
  });

  it('lists the Director session, then the cancel after a group break', () => {
    const items = planningMenuItems(true);

    expect(items.map((item) => item.label)).toEqual(['Xem phiên Giám đốc', 'Huỷ prompt này…']);
    expect(items[1]).toMatchObject({ danger: true, startsGroup: true });
  });
});

describe('projectMenuItems', () => {
  const project = {
    key: 'b:/a',
    name: 'a',
    path: '/a',
    collapsed: false,
    switchTo: null,
    cleanable: [],
  };

  it('folds an open project and copies its path', () => {
    expect(projectMenuItems(project).map((item) => item.label)).toEqual([
      'Thu gọn',
      'Sao chép đường dẫn',
      'Đổi tên thư mục',
    ]);
  });

  it('opens a folded project', () => {
    expect(projectMenuItems({ ...project, collapsed: true })[0]?.label).toBe('Mở rộng');
  });

  it('offers the board switch only for a folder that is not active', () => {
    const inactive = projectMenuItems({ ...project, switchTo: '/b' });
    expect(inactive.find((item) => item.label === 'Mở thư mục này trên bảng')).toMatchObject({
      startsGroup: true,
    });
    expect(projectMenuItems(project).some((item) => item.id === 'open-board')).toBe(false);
  });

  it('ends with cleanup of errored sessions as the danger item', () => {
    const items = projectMenuItems({ ...project, cleanable: ['s1', 's2'] });

    expect(items[items.length - 1]).toMatchObject({
      label: 'Dọn 2 phiên lỗi…',
      danger: true,
    });
    expect(dangerIsSuffix(items)).toBe(true);
  });

  it('omits the path copy when the project has no path', () => {
    expect(
      projectMenuItems({ ...project, path: null }).some((item) => item.id === 'copy-path'),
    ).toBe(false);
  });
});

describe('menu rules', () => {
  const menus: Array<[string, AgentMenuItem[]]> = [
    ['session', sessionMenuItems(BUSY_SESSION, { maximized: false })],
    ['task with session', taskCardMenuItems({ code: 'T1', contractId: 'c1' }, BUSY_SESSION, null)],
    ['task without session', taskCardMenuItems({ code: 'T1', contractId: null }, null, null)],
    ['planning with session', planningMenuItems(true)],
    ['planning without session', planningMenuItems(false)],
    [
      'herdr',
      herdrMenuItems('/repo', { maximized: false }, { folder: '/repo', privileged: true }),
    ],
    [
      'project',
      projectMenuItems({
        key: 'b:/a',
        name: 'a',
        path: '/a',
        collapsed: false,
        switchTo: '/b',
        cleanable: ['s1'],
      }),
    ],
  ];

  it.each(menus)('%s disables nothing except a refused delete', (_name, items) => {
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(
      items.some((item) => item.id === 'control-delete' && item.disabled) ? ['control-delete'] : [],
    );
  });

  it.each(menus)('%s shows a hint only beside a refused delete', (_name, items) => {
    expect(items.filter((item) => item.hint !== null).map((item) => item.id)).toEqual(
      items.some((item) => item.id === 'control-delete' && item.disabled) ? ['control-delete'] : [],
    );
  });

  it.each(menus)('%s ends in its danger items', (_name, items) => {
    expect(dangerIsSuffix(items)).toBe(true);
  });

  it.each(menus)('%s never opens a group with its first item', (_name, items) => {
    expect(items[0]?.startsGroup).toBe(false);
  });

  it.each(menus)('%s gives every item a glyph', (_name, items) => {
    expect(items.every((item) => item.icon.length > 0)).toBe(true);
  });

  it.each(menus)('%s carries no filler line about a missing session', (_name, items) => {
    expect(items.some((item) => item.label.includes('Chưa có'))).toBe(false);
  });
});

describe('herdr and session actions moved into the menu', () => {
  it('keeps the pane actions that used to sit on the drawer', () => {
    const labels = herdrMenuItems('/repo', null, null).map((item) => item.label);

    expect(labels).toContain('Mở trong herdr');
    expect(labels).toContain('Đọc lại màn hình');
  });
});

describe('herdrMenuItems', () => {
  it('lists the herdr views, the pane actions, then the copies', () => {
    expect(herdrMenuItems('/repo', null, null).map((item) => item.label)).toEqual([
      'Xem chi tiết',
      'Đổi tên…',
      'Xem màn hình',
      'Đọc lại màn hình',
      'Mở trong herdr',
      'Sao chép màn hình',
      'Sao chép thư mục',
      'Sao chép pane id',
      'Xoá phiên…',
    ]);
  });

  it('offers the cloud handoff only on an omp pane, whose session fast-handoff takes up', () => {
    expect(herdrMenuItems('/repo', null, null, true).map((item) => item.label)).toContain('Đẩy lên cloud làm tiếp');
    expect(herdrMenuItems('/repo', null, null, false).map((item) => item.label)).not.toContain('Đẩy lên cloud làm tiếp');
  });

  it('maps the info and screen items to the drawer tabs', () => {
    const items = herdrMenuItems('/repo', null, null);

    expect(items.find((item) => item.id === 'info')?.action).toEqual({
      kind: 'herdrTab',
      tab: 'info',
    });
    expect(items.find((item) => item.id === 'screen')?.action).toEqual({
      kind: 'herdrTab',
      tab: 'screen',
    });
  });

  it('omits the folder copy when herdr reports no folder', () => {
    expect(herdrMenuItems(null, null, null).some((item) => item.label === 'Sao chép thư mục')).toBe(
      false,
    );
  });

  it('offers maximize from the drawer header', () => {
    expect(
      herdrMenuItems('/repo', { maximized: false }, null).some((item) => item.label === 'Phóng to'),
    ).toBe(true);
  });
});

describe('work item actions in the agent menu', () => {
  const WORK = { folder: '/work', privileged: true };

  it('offers assign and describe-role from a session that takes work', () => {
    const items = sessionMenuItems({ ...BUSY_SESSION, work: WORK }, null);

    expect(items.find((item) => item.id === 'assign-work')).toMatchObject({
      label: 'Giao việc cho agent này…',
      danger: false,
      action: { kind: 'assignWork' },
    });
    expect(items.find((item) => item.id === 'describe-role')).toMatchObject({
      label: 'Mô tả vai trò…',
      danger: false,
      action: { kind: 'describeRole' },
    });
  });

  it.each(['busy', 'idle', 'parked'])('offers work to a %s session', (status) => {
    const items = sessionMenuItems({ ...BUSY_SESSION, status, work: WORK }, null);

    expect(items.map((item) => item.id)).toContain('assign-work');
  });

  it.each(['archived', 'stopped', 'crashed'])('offers no work to a %s session', (status) => {
    const items = sessionMenuItems({ ...BUSY_SESSION, status, work: WORK }, null);

    expect(items.map((item) => item.id)).not.toContain('assign-work');
    expect(items.map((item) => item.id)).not.toContain('describe-role');
  });

  it('offers no work from a read-only browser tab', () => {
    const items = sessionMenuItems(
      { ...BUSY_SESSION, work: { folder: '/work', privileged: false } },
      null,
    );

    expect(items.map((item) => item.id)).not.toContain('assign-work');
  });

  it('offers no work to a session whose folder is unknown', () => {
    const items = sessionMenuItems(
      { ...BUSY_SESSION, work: { folder: null, privileged: true } },
      null,
    );

    expect(items.map((item) => item.id)).not.toContain('assign-work');
  });

  it('places the work group after the pane actions and before the copies', () => {
    const labels = herdrMenuItems('/repo', null, { folder: '/repo', privileged: true }).map(
      (item) => item.label,
    );

    expect(labels).toEqual([
      'Xem chi tiết',
      'Đổi tên…',
      'Xem màn hình',
      'Đọc lại màn hình',
      'Mở trong herdr',
      'Giao việc cho agent này…',
      'Mô tả vai trò…',
      'Sao chép màn hình',
      'Sao chép thư mục',
      'Sao chép pane id',
      'Xoá phiên…',
    ]);
  });

  it('offers work from a herdr agent only when the server tags it with a folder', () => {
    const tagged = herdrMenuItems('/repo', null, { folder: '/repo', privileged: true });
    expect(tagged.find((item) => item.id === 'assign-work')).toMatchObject({ startsGroup: true });

    const untagged = herdrMenuItems(null, null, { folder: null, privileged: true });
    expect(untagged.map((item) => item.id)).not.toContain('assign-work');
  });

  it('offers no work from a herdr agent in a read-only tab', () => {
    const items = herdrMenuItems('/repo', null, { folder: '/repo', privileged: false });

    expect(items.map((item) => item.id)).not.toContain('assign-work');
  });

  it('offers no work from a sleeping or planning menu', () => {
    const items = [...sleepingMenuItems(null), ...planningMenuItems(true)];

    expect(items.map((item) => item.id)).not.toContain('assign-work');
  });

  it("gives a task card its session's work after the group break", () => {
    const items = taskCardMenuItems(
      { code: 'T1', contractId: null },
      { ...BUSY_SESSION, work: WORK },
      null,
    );

    expect(items.map((item) => item.id)).toContain('assign-work');
  });
  it.each([
    ['queued', ['work-open', 'work-assign', 'work-done', 'work-failed', 'work-cancel']],
    [
      'review',
      ['work-open', 'work-assign', 'work-follow-up', 'work-done', 'work-failed', 'work-squad'],
    ],
    ['failed', ['work-open', 'work-assign', 'work-follow-up', 'work-done', 'work-cancel']],
    ['done', ['work-open', 'work-cancel']],
  ] as const)('selects valid actions for a %s work item', (status, expected) => {
    const items = workItemCardMenuItems({
      id: 'work-1',
      sequence: 1,
      text: 'Build the feature',
      status,
      privileged: true,
      canJudge: false,
      canCleanWorktree: false,
      canAskLeader: status === 'review',
    });
    const ids = items.map((entry) => entry.id);

    expect(ids.slice(0, expected.length)).toEqual(expected);
    expect(ids).toContain('copy-work-code');
    expect(ids).toContain('copy-work-text');
  });

  it('offers only read-only identity and detail actions when the connection lacks permission', () => {
    const items = workItemCardMenuItems({
      id: 'work-1',
      sequence: 1,
      text: 'Build the feature',
      status: 'queued',
      privileged: false,
      canJudge: true,
      canCleanWorktree: true,
      canAskLeader: true,
    });

    expect(items.map((entry) => entry.id)).toEqual([
      'work-open',
      'copy-work-code',
      'copy-work-text',
    ]);
});
});

describe('squad run actions in the agent menu', () => {
  const facts = {
    runId: 'run-1',
    request: 'Build the feature',
    status: 'planning' as const,
    hasProposal: false,
    privileged: true,
  };

  it.each([
    ['planning', false, ['squad-open', 'squad-cancel']],
    ['proposed', true, ['squad-open', 'squad-approve', 'squad-dismiss', 'squad-cancel']],
    ['proposed', false, ['squad-open', 'squad-cancel']],
    ['working', false, ['squad-open', 'squad-cancel']],
    ['done', false, ['squad-open', 'squad-remove']],
    ['dismissed', false, ['squad-open', 'squad-remove']],
    ['stopped', false, ['squad-open', 'squad-remove']],
    ['failed', false, ['squad-open', 'squad-retry', 'squad-remove']],
  ] as const)('selects valid actions for a %s run', (status, hasProposal, expected) => {
    const items = squadRunMenuItems({ ...facts, status, hasProposal });
    const ids = items.map((entry) => entry.id);
    expect(ids.slice(0, expected.length)).toEqual(expected);
    expect(ids).toContain('copy-squad-run-code');
    expect(ids).toContain('copy-squad-request');
  });

  it('offers only read-only actions without permission', () => {
    const items = squadRunMenuItems({ ...facts, privileged: false });
    expect(items.map((entry) => entry.id)).toEqual([
      'squad-open',
      'copy-squad-run-code',
      'copy-squad-request',
    ]);
  });
});

describe('herdrNameProblem', () => {
  it.each(['a', 'claude-1', 'pane_2', 'a'.repeat(32), '  spaced  '])('accepts %j', (name) => {
    expect(herdrNameProblem(name)).toBeNull();
  });

  it.each(['', '   ', '1pane', 'Pane', 'has space', 'dot.name', 'a'.repeat(33)])(
    'refuses %j with a reason',
    (name) => {
      expect(herdrNameProblem(name)).not.toBeNull();
    },
  );

  it('explains a blank name and a malformed one differently', () => {
    expect(herdrNameProblem('')).toBe('Tên không được để trống.');
    expect(herdrNameProblem('Pane')).toMatch(/^Tên không hợp lệ\. /);
  });
});

describe('sessionNameProblem', () => {
  it('refuses a blank name and one over 60 characters', () => {
    expect(sessionNameProblem('   ')).toBe('Tên không được để trống.');
    expect(sessionNameProblem('x'.repeat(61))).toBe('Tên tối đa 60 ký tự.');
  });

  it('accepts a name up to 60 characters, trimmed first', () => {
    expect(sessionNameProblem('x'.repeat(60))).toBeNull();
    expect(sessionNameProblem('  Đội 1  ')).toBeNull();
  });
});

describe('placeMenu', () => {
  const size = { width: 240, height: 300 };
  const viewport = { width: 1000, height: 800 };

  it('opens at the pointer when the menu fits', () => {
    expect(placeMenu({ x: 100, y: 120 }, size, viewport)).toEqual({ x: 100, y: 120 });
  });

  it('pulls the menu back inside the right and bottom edges', () => {
    expect(placeMenu({ x: 990, y: 790 }, size, viewport)).toEqual({
      x: 1000 - 240 - MENU_MARGIN_PX,
      y: 800 - 300 - MENU_MARGIN_PX,
    });
  });

  it('keeps the menu off the left and top edges', () => {
    expect(placeMenu({ x: -20, y: -5 }, size, viewport)).toEqual({
      x: MENU_MARGIN_PX,
      y: MENU_MARGIN_PX,
    });
  });

  it('keeps the margin even when the viewport is smaller than the menu', () => {
    expect(placeMenu({ x: 50, y: 50 }, size, { width: 100, height: 100 })).toEqual({
      x: MENU_MARGIN_PX,
      y: MENU_MARGIN_PX,
    });
  });
});

describe('agentMenuTriggers', () => {
  const subject: AgentMenuSubject = { kind: 'herdr', paneId: 'p1', drawer: null };

  it('opens at the pointer on a right click and cancels the native menu', () => {
    const open = vi.fn();
    const preventDefault = vi.fn();
    const element = {
      getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
    } as unknown as MenuTarget;
    const event = {
      preventDefault,
      clientX: 40,
      clientY: 60,
      currentTarget: element,
    } as unknown as ReactMouseEvent<MenuTarget>;

    agentMenuTriggers<MenuTarget>(subject, open).onContextMenu(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({
      subject,
      anchor: { x: 40, y: 60 },
      returnFocus: element,
    });
  });

  it('opens below the element for the context-menu key and for Shift+F10', () => {
    const open = vi.fn();
    const element = {
      getBoundingClientRect: () => ({ left: 100, bottom: 200 }),
    } as unknown as MenuTarget;
    const triggers = agentMenuTriggers<MenuTarget>(subject, open);

    for (const key of [
      { key: 'ContextMenu', shiftKey: false },
      { key: 'F10', shiftKey: true },
    ]) {
      const event = {
        ...key,
        preventDefault: vi.fn(),
        currentTarget: element,
      } as unknown as ReactKeyboardEvent<MenuTarget>;
      triggers.onKeyDown(event);
    }

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith({
      subject,
      anchor: { x: 112, y: 200 },
      returnFocus: element,
    });
  });

  it('ignores a bare F10 and every other key', () => {
    const open = vi.fn();
    const triggers = agentMenuTriggers<MenuTarget>(subject, open);
    const element = {
      getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
    } as unknown as MenuTarget;

    for (const key of ['F10', 'Enter', 'Escape']) {
      const event = {
        key,
        shiftKey: false,
        preventDefault: vi.fn(),
        currentTarget: element,
      } as unknown as ReactKeyboardEvent<MenuTarget>;
      triggers.onKeyDown(event);
    }

    expect(open).not.toHaveBeenCalled();
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the text and reports success', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('C:/repo')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('C:/repo');
  });

  it('reports a refused write as a failure instead of throwing', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });

    await expect(copyText('C:/repo')).resolves.toBe(false);
  });

  it('reports a missing clipboard as a failure', async () => {
    vi.stubGlobal('navigator', {});

    await expect(copyText('C:/repo')).resolves.toBe(false);
  });
});

describe('company request builders and replay rules', () => {
  it('builds the rename and info requests the server expects', () => {
    expect(sessionRename('r1', 's1', 'Đội A')).toEqual({
      type: 'companySessionRename',
      requestId: 'r1',
      sessionId: 's1',
      name: 'Đội A',
    });
    expect(sessionInfoRequest('r2', 's1')).toEqual({
      type: 'companySessionInfoRequest',
      requestId: 'r2',
      sessionId: 's1',
    });
    expect(herdrClose('r5', 'p1')).toEqual({
      type: 'herdrClose',
      requestId: 'r5',
      paneId: 'p1',
    });
    expect(herdrRename('r3', 'p1', 'builder')).toEqual({
      type: 'herdrRename',
      requestId: 'r3',
      paneId: 'p1',
      name: 'builder',
    });
    expect(herdrInfoRequest('r4', 'p1')).toEqual({
      type: 'herdrInfoRequest',
      requestId: 'r4',
      paneId: 'p1',
    });
  });

  it('accepts the info replies from the server', () => {
    expect(isCompanyServerMessage({ type: 'companySessionInfo' })).toBe(true);
    expect(isCompanyServerMessage({ type: 'herdrInfo' })).toBe(true);
  });

  it('replays the read-only info requests on reconnect, never a rename', () => {
    expect(isReplayableClientMessage({ type: 'companySessionInfoRequest' })).toBe(true);
    expect(isReplayableClientMessage({ type: 'herdrInfoRequest' })).toBe(true);
    expect(isReplayableClientMessage({ type: 'companySessionRename' })).toBe(false);
    expect(isReplayableClientMessage({ type: 'herdrRename' })).toBe(false);
  });
});
