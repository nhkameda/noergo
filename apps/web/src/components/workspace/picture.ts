'use client';

import type { NoteDto } from '@noergo/core/dto';
import type { NoteImage } from '@noergo/core/db/types';
import { preload, readPicture, UPLOAD_NOTICE, UploadError, uploadPicture, fileUrl } from './cover-client';
import type { WorkspaceStore } from './store';

/**
 * Picture ideas in the browser: sending a picture, and the size of each. The server writes
 * a picture's size into the note; until its answer arrives, the size measured here keeps the
 * idea's shape in proportion.
 */

const sizes = new Map<string, NoteImage>();

/**
 * The proportions an idea's picture is drawn at (width / height), or null when it is not
 * one. On a map, a very tall or very wide picture is cut to a shape that still reads there;
 * `exact` keeps its own, to show it whole.
 */
export function pictureRatio(note: NoteDto | null | undefined, { exact = false } = {}): number | null {
  if (!note?.attachmentId || note.kind !== 'image') return null;
  const s = note.image ?? sizes.get(note.attachmentId);
  if (!s) return 4 / 3;
  return exact ? s.w / s.h : Math.min(3, Math.max(0.5, s.w / s.h));
}

export const pictureSrc = (note: NoteDto, api: string) => fileUrl(note.attachmentId!, api);

/** The image files among what was dropped or pasted. */
export function picturesIn(dt: DataTransfer | null): File[] {
  return dt ? [...dt.files].filter((f) => f.type.startsWith('image/')) : [];
}

/** A file's name as the idea's title; a pasted screenshot ("image.png") has none worth keeping. */
export function pictureTitle(file: File): string {
  const name = file.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
  return /^(image|imagem|img|pasted|clipboard|blob)$/i.test(name) ? '' : name.slice(0, 200);
}

/** Sends a picture; its stored id once it is there, or null (the reason is on screen). */
export async function sendPicture(file: Blob, store: WorkspaceStore): Promise<string | null> {
  try {
    const pic = await readPicture(file);
    try {
      const up = await uploadPicture(pic.blob);
      sizes.set(up.id, { w: up.width, h: up.height });
      await preload(fileUrl(up.id));
      return up.id;
    } finally {
      URL.revokeObjectURL(pic.src);
    }
  } catch (err) {
    store.notify({ tone: 'error', key: UPLOAD_NOTICE[err instanceof UploadError ? err.code : 'invalid'] ?? 'coverFailed' });
    return null;
  }
}
