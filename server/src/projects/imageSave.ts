/**
 * imageSave: keeps an image pasted or dropped into the prompt box on disk.
 *
 * A prompt reaches an agent as text typed into its terminal, so an image travels as
 * a path the agent can open (omp and Claude Code read images from a path). The file
 * lands under ~/.pixel-agents/attachments with a name the board picks, never the
 * one the browser sent, so no input reaches the path.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProjectImageSaveMessage } from '../../../core/src/messages.js';
import { LAYOUT_FILE_DIR } from '../constants.js';
import { IMAGE_UPLOAD_KEEP_DAYS } from '../fleet/imageUpload.js';
import { LibraryUserError } from '../library/libraryError.js';

/** Largest image the box keeps, decoded: 10 MiB. */
export const PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Readonly<Record<ProjectImageSaveMessage['mediaType'], string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function defaultAttachmentDir(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, 'attachments');
}

/**
 * Saves the image here and, when the prompt is going to a cloud machine, keeps it there too: the path answered is
 * the one the agent can open, which on a machine is not a file of this computer.
 */
export async function savePromptImageFor(
  request: Pick<ProjectImageSaveMessage, 'mediaType' | 'dataBase64' | 'machine'>,
  cloudImage: ((machine: string, fileName: string, dataBase64: string) => Promise<string>) | undefined,
  dir: string = defaultAttachmentDir(),
): Promise<string> {
  if (request.machine !== undefined && cloudImage === undefined) throw new LibraryUserError('Chưa nối được tới máy cloud để gửi ảnh.');
  const local = await savePromptImage(request, dir);
  if (request.machine === undefined || cloudImage === undefined) return local;
  return cloudImage(request.machine, path.basename(local), request.dataBase64);
}

/** Writes the image and returns its absolute path. */
export async function savePromptImage(
  request: Pick<ProjectImageSaveMessage, 'mediaType' | 'dataBase64'>,
  dir: string = defaultAttachmentDir(),
  now: Date = new Date(),
): Promise<string> {
  const extension = (EXTENSIONS as Readonly<Record<string, string>>)[request.mediaType];
  if (extension === undefined) throw new LibraryUserError('Chỉ nhận ảnh PNG, JPEG, GIF hoặc WebP.');
  if (typeof request.dataBase64 !== 'string') throw new LibraryUserError('Dữ liệu ảnh không hợp lệ.');
  const bytes = Buffer.from(request.dataBase64, 'base64');
  // Buffer.from drops what is not base64; a payload that does not round-trip is refused.
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== request.dataBase64.replace(/=+$/, '')) {
    throw new LibraryUserError('Dữ liệu ảnh không hợp lệ.');
  }
  if (bytes.length > PROMPT_IMAGE_MAX_BYTES) throw new LibraryUserError('Ảnh lớn hơn 10 MB.');
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const file = path.join(dir, `${stamp}-${randomUUID().slice(0, 8)}.${extension}`);
  await fs.writeFile(file, bytes);
  await pruneOldImages(dir, now);
  return file;
}

const SAVED_IMAGE_NAME = /^\d{14}-[0-9a-f]{8}\.(?:png|jpg|gif|webp)$/;

/** Removes images this board saved more than IMAGE_UPLOAD_KEEP_DAYS ago; other files stay, and a failure never fails the save. */
async function pruneOldImages(dir: string, now: Date): Promise<void> {
  const cutoff = now.getTime() - IMAGE_UPLOAD_KEEP_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const name of await fs.readdir(dir)) {
      if (!SAVED_IMAGE_NAME.test(name)) continue;
      const file = path.join(dir, name);
      if ((await fs.stat(file)).mtimeMs < cutoff) await fs.rm(file, { force: true });
    }
  } catch (error) {
    console.warn('[Pixel Agents] Could not prune old prompt images:', error);
  }
}
