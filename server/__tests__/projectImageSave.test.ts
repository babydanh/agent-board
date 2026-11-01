import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectImageSaveMessage } from '../../core/src/messages.js';
import { PROMPT_IMAGE_MAX_BYTES, savePromptImage, savePromptImageFor } from '../src/projects/imageSave.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

let dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-image-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('savePromptImage', () => {
  it('writes the bytes under a name of its own, with the extension of the type', async () => {
    const dir = await tempDir();
    const file = await savePromptImage({ mediaType: 'image/png', dataBase64: PNG }, dir, new Date('2026-10-21T10:05:06Z'));
    expect(path.dirname(file)).toBe(dir);
    expect(path.basename(file)).toMatch(/^20261021100506-[0-9a-f]{8}\.png$/);
    expect((await fs.readFile(file)).toString('base64')).toBe(PNG);
  });

  it('removes saved images older than a week when it saves a new one, and leaves other files', async () => {
    const dir = await tempDir();
    const old = path.join(dir, '20200101000000-aaaaaaaa.png');
    const recent = path.join(dir, '20261015000000-bbbbbbbb.png');
    const other = path.join(dir, 'notes.txt');
    for (const file of [old, recent, other]) await fs.writeFile(file, 'x');
    const now = new Date('2026-10-21T10:05:06Z');
    const ancient = new Date('2020-01-01T00:00:00Z');
    await fs.utimes(old, ancient, ancient);
    await fs.utimes(other, ancient, ancient);
    await fs.utimes(recent, new Date('2026-10-15T00:00:00Z'), new Date('2026-10-15T00:00:00Z'));

    const saved = await savePromptImage({ mediaType: 'image/png', dataBase64: PNG }, dir, now);

    expect((await fs.readdir(dir)).sort()).toEqual([path.basename(recent), 'notes.txt', path.basename(saved)].sort());
  });

  it('refuses a type it does not keep, a payload that is not base64, and one over the limit', async () => {
    const dir = await tempDir();
    const save = (request: { mediaType: string; dataBase64: string }) =>
      savePromptImage(request as Pick<ProjectImageSaveMessage, 'mediaType' | 'dataBase64'>, dir);
    await expect(save({ mediaType: 'image/svg+xml', dataBase64: PNG })).rejects.toThrow();
    await expect(save({ mediaType: 'image/png', dataBase64: '@@not base64@@' })).rejects.toThrow();
    const big = Buffer.alloc(PROMPT_IMAGE_MAX_BYTES + 1).toString('base64');
    await expect(save({ mediaType: 'image/png', dataBase64: big })).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe('savePromptImageFor (TC-CLOUDIMG-02)', () => {
  it('answers with the local path when no machine is named', async () => {
    const dir = await tempDir();
    const file = await savePromptImageFor({ mediaType: 'image/png', dataBase64: PNG }, undefined, dir);
    expect(path.dirname(file)).toBe(dir);
  });

  it('keeps the image on the named machine and answers with its path there', async () => {
    const dir = await tempDir();
    const calls: { machine: string; fileName: string; dataBase64: string }[] = [];
    const cloudImage = async (machine: string, fileName: string, dataBase64: string) => {
      calls.push({ machine, fileName, dataBase64 });
      return `/data/home/.board-images/${fileName}`;
    };

    const result = await savePromptImageFor({ mediaType: 'image/png', dataBase64: PNG, machine: 'danh1' }, cloudImage, dir);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ machine: 'danh1', dataBase64: PNG });
    expect(calls[0]?.fileName).toMatch(/^\d{14}-[0-9a-f]{8}\.png$/);
    expect(result).toBe(`/data/home/.board-images/${calls[0]?.fileName}`);
  });

  it('refuses a machine image when cloud upload is not wired, instead of answering a path the machine cannot open', async () => {
    const dir = await tempDir();
    await expect(savePromptImageFor({ mediaType: 'image/png', dataBase64: PNG, machine: 'danh1' }, undefined, dir)).rejects.toThrow();
  });
});
