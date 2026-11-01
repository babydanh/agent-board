/**
 * usePromptImages: sends the prompt box's images to the server and appends each
 * saved path to the draft (see `promptImages.ts` for why a path, not bytes).
 * Each saved image keeps a local preview while its path is still in the draft.
 */

import { useEffect, useSyncExternalStore } from 'react';

import type { ProjectImageSaveMessage } from '../../../core/src/messages.js';
import type { CompanyClient } from './companyClient.js';
import { projectStore } from './projects/projectClient.js';
import { useProjectState } from './projects/projectStore.js';
import {
  IMAGE_SAVE_FALLBACK,
  IMAGE_SIZE_NOTICE,
  IMAGE_TYPE_NOTICE,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_TYPES,
  withImagePath,
} from './promptImages.js';

/** One saved image: its path in the draft and a browser URL of its bytes. */
export interface PromptImagePreview {
  readonly path: string;
  readonly url: string;
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * The images outlive the composer: it unmounts on pages without a prompt box while the draft keeps
 * its paths and a save may still be on its way, so both lists live here and come back with it.
 */
interface ImageStore {
  readonly pending: readonly { readonly id: string; readonly url: string }[];
  readonly saved: readonly PromptImagePreview[];
}

let imageStore: ImageStore = { pending: [], saved: [] };
const listeners = new Set<() => void>();

function updateImages(next: (current: ImageStore) => ImageStore): void {
  imageStore = next(imageStore);
  for (const listener of listeners) listener();
}

function subscribeImages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * `draftText` is the prompt as typed: a preview lives only while its path is in it, so deleting
 * the path or sending the prompt drops the preview. `onNotice` hears refusals; `saving` counts the
 * images still on their way.
 */
export function usePromptImages(
  client: CompanyClient,
  onNotice: (text: string) => void,
  draftText: string,
  machine?: string,
): {
  attach: (files: readonly File[]) => void;
  saving: number;
  previews: readonly PromptImagePreview[];
} {
  const projects = useProjectState(projectStore);
  const { pending, saved } = useSyncExternalStore(subscribeImages, () => imageStore);

  useEffect(() => {
    const done = pending.filter((entry) => projects.results[entry.id] !== undefined);
    if (done.length === 0) return;
    const added: PromptImagePreview[] = [];
    for (const entry of done) {
      const result = projects.results[entry.id];
      if (result?.type === 'projectImageSaved') {
        client.setDraftText(withImagePath(client.getState().prompt.text, result.path));
        added.push({ path: result.path, url: entry.url });
      } else {
        URL.revokeObjectURL(entry.url);
        onNotice((result !== undefined && 'reason' in result && result.reason) || IMAGE_SAVE_FALLBACK);
      }
    }
    updateImages((current) => ({
      pending: current.pending.filter((entry) => !done.includes(entry)),
      saved: [...current.saved, ...added],
    }));
  }, [client, onNotice, pending, projects.results]);

  // A preview whose path left the draft frees its bytes.
  useEffect(() => {
    const gone = saved.filter((preview) => !draftText.includes(preview.path));
    if (gone.length === 0) return;
    for (const preview of gone) URL.revokeObjectURL(preview.url);
    updateImages((current) => ({ ...current, saved: current.saved.filter((preview) => !gone.includes(preview)) }));
  }, [draftText, saved]);

  const attach = (files: readonly File[]) => {
    for (const file of files) {
      if (!PROMPT_IMAGE_TYPES.has(file.type)) {
        onNotice(IMAGE_TYPE_NOTICE);
        continue;
      }
      if (file.size > PROMPT_IMAGE_MAX_BYTES) {
        onNotice(IMAGE_SIZE_NOTICE);
        continue;
      }
      void base64Of(file).then(
        (dataBase64) => {
          const id = projectStore.saveImage({
            fileName: file.name || 'anh',
            mediaType: file.type as ProjectImageSaveMessage['mediaType'],
            dataBase64,
            ...(machine === undefined ? {} : { machine }),
          });
          updateImages((current) => ({ ...current, pending: [...current.pending, { id, url: URL.createObjectURL(file) }] }));
        },
        () => onNotice(IMAGE_SAVE_FALLBACK),
      );
    }
  };

  return {
    attach,
    saving: pending.length,
    previews: saved.filter((preview) => draftText.includes(preview.path)),
  };
}
