/** What the board says while a slow project-tree write waits for the server; null when only reads are pending. */
export function projectBusyLabel(pending: readonly { readonly type: string }[]): string | null {
  const types = new Set(pending.map((request) => request.type));
  if (types.has('projectNodeCreate')) return 'Đang tạo project / thêm thư mục…';
  if (types.has('projectNodeDelete')) return 'Đang xóa khỏi danh sách…';
  if (types.has('projectNodeMove')) return 'Đang di chuyển…';
  return null;
}
