/** A file name the board picked for a saved prompt image (stamp, short id, extension); nothing else reaches the machine's shell. */
export const IMAGE_UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|jpg|gif|webp)$/;
/** How long a kept image stays on the machine, and the shape of the names the board gave them (stamp, short id). */
export const IMAGE_UPLOAD_KEEP_DAYS = 7;
const IMAGE_UPLOAD_KEPT_PATTERN = '??????????????-????????.*';
/** Standard base64 only: no line break can end the here-document early. */
export const IMAGE_UPLOAD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The shell the board runs on a cloud machine (`bash -s -- <name>`, script on stdin) to keep one prompt image there,
 * so an agent on that machine can open it by path. The name is only ever read as "$1"; the image rides inside a
 * quoted here-document, so the shell reads it as text. The last line is `OK <path>`.
 */
export function imageUploadScript(dataBase64: string): string {
  return [
    'set -u',
    'dir="$HOME/.board-images"',
    'mkdir -p "$dir" || { echo "Khong tao duoc thu muc anh"; exit 1; }',
    // Images this board kept more than a week ago go; any other file in the folder is left alone.
    `find "$dir" -maxdepth 1 -type f -name '${IMAGE_UPLOAD_KEPT_PATTERN}' -mtime +${IMAGE_UPLOAD_KEEP_DAYS} -delete 2>/dev/null`,
    'file="$dir/$1"',
    'base64 -d > "$file" <<\'BOARD_IMAGE_B64\' || { rm -f "$file"; echo "Khong ghi duoc anh"; exit 1; }',
    dataBase64,
    'BOARD_IMAGE_B64',
    '[ -s "$file" ] || { echo "Khong ghi duoc anh"; exit 1; }',
    'echo "OK $file"',
    '',
  ].join('\n');
}
