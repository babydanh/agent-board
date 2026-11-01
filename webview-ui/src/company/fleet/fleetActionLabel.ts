import type { FleetAction } from './fleetStore.js';

/** What the board says while a cloud action waits for its machine. */
export const FLEET_ACTION_LABEL: Record<FleetAction['kind'], string> = {
  terminal: 'Đang mở terminal',
  task: 'Đang tạo worktree và mở Claude',
  clean: 'Đang dọn phiên trên máy cloud',
  wake: 'Đang bật máy cloud',
  lavish: 'Đang nối cổng tới Lavish',
  lavishDelete: 'Đang xóa trang Lavish',
  diff: 'Đang đọc thay đổi',
  history: 'Đang lấy lịch sử',
  comment: 'Đang gửi tin tới phiên',
  branch: 'Đang cập nhật nhánh',
};
