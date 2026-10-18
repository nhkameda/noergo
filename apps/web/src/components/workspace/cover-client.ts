'use client';

import type { LaneDto } from '@noergo/core/dto';
import { useState, useSyncExternalStore, type DragEvent } from 'react';
import type { Actions } from './actions';
import { autoBackground, dominantColors, edgeColor, FRAME_DEFAULT, type Framed } from './cover';
import type { WorkspaceStore } from './store';

/**
 * Covers in the browser: reading a dropped picture, sending it, and the live preview that
 * lets every view of a column (its top, its card, its map) follow a drag before the
 * change is saved.
 */

export const fileUrl = (id: string) => `/api/files/${id}`;

export interface CoverLook extends Framed {
  src: string;
  bg: string | null;
}

// ───────────────────────────── preview while adjusting

interface Preview {
  cover?: CoverLook | null;
  color?: string | null;
  /** A dropped picture on its way to the server. */
  uploading?: true;
}

const previews = new Map<string, Preview>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Shows `p` for the column instead of what is saved, until clearPreview. */
export function setPreview(laneId: string, p: Preview) {
  previews.set(laneId, { ...previews.get(laneId), ...p });
  emit();
}

export const peekPreview = (laneId: string): Preview | undefined => previews.get(laneId);

export function clearPreview(laneId: string, part?: keyof Preview) {
  const cur = previews.get(laneId);
  if (!cur) return;
  const rest = { ...cur };
  if (part) delete rest[part];
  if (part && Object.keys(rest).length) previews.set(laneId, rest);
  else previews.delete(laneId);
  emit();
}

/** What a column looks like now: its saved cover and colour, or the preview over them. */
export function useLaneLook(lane: LaneDto | undefined): { cover: CoverLook | null; color: string | null; uploading: boolean } {
  const p = useSyncExternalStore(
    subscribe,
    () => (lane ? previews.get(lane.id) : undefined),
    () => undefined,
  );
  const saved = lane?.cover ? { ...lane.cover, src: fileUrl(lane.cover.fileId) } : null;
  return {
    cover: p && p.cover !== undefined ? p.cover : saved,
    color: p && p.color !== undefined ? p.color : (lane?.color ?? null),
    uploading: !!p?.uploading,
  };
}

// ───────────────────────────── files dragged in from the desktop

let fileDrag = false;
let depth = 0;
const dragListeners = new Set<() => void>();
const hasFiles = (e: globalThis.DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
const setFileDrag = (v: boolean) => {
  if (fileDrag === v) return;
  fileDrag = v;
  dragListeners.forEach((f) => f());
};

function installDragWatch() {
  const enter = (e: globalThis.DragEvent) => {
    if (!hasFiles(e)) return;
    depth++;
    setFileDrag(true);
  };
  const leave = (e: globalThis.DragEvent) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setFileDrag(false);
  };
  // A picture let go outside a drop zone would otherwise replace the page with itself.
  const over = (e: globalThis.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer && !(e.target as Element | null)?.closest?.('[data-cover-drop]')) e.dataTransfer.dropEffect = 'none';
  };
  const end = (e: globalThis.DragEvent) => {
    if (e.type === 'drop' && hasFiles(e)) e.preventDefault();
    depth = 0;
    setFileDrag(false);
  };
  window.addEventListener('dragenter', enter);
  window.addEventListener('dragleave', leave);
  window.addEventListener('dragover', over);
  window.addEventListener('drop', end);
  window.addEventListener('dragend', end);
  return () => {
    window.removeEventListener('dragenter', enter);
    window.removeEventListener('dragleave', leave);
    window.removeEventListener('dragover', over);
    window.removeEventListener('drop', end);
    window.removeEventListener('dragend', end);
  };
}

let uninstall: (() => void) | null = null;
const subscribeDrag = (f: () => void) => {
  dragListeners.add(f);
  uninstall ??= installDragWatch();
  return () => {
    dragListeners.delete(f);
    if (!dragListeners.size) {
      uninstall?.();
      uninstall = null;
    }
  };
};

/** True while files from outside the page are being dragged over it. */
export const useFileDrag = () => useSyncExternalStore(subscribeDrag, () => fileDrag, () => false);

export function firstImage(list: DataTransfer | null | undefined): File | null {
  for (const f of list?.files ?? []) if (f.type.startsWith('image/')) return f;
  return null;
}

/**
 * Makes an element a place to drop a picture. `over` lights it up; a drop that holds
 * no picture calls onRefused (to say why nothing happened).
 */
export function useImageDrop(onImage: (file: File) => void, onRefused: () => void) {
  const [over, setOver] = useState(false);
  const props = {
    'data-cover-drop': true,
    onDragOver: (e: DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      setOver(false);
      const file = firstImage(e.dataTransfer);
      if (file) onImage(file);
      else onRefused();
    },
  };
  return { over, props };
}

// ───────────────────────────── reading and sending a picture

export interface Picture {
  /** What is sent: the picture itself, or a smaller copy of a very large one. */
  blob: Blob;
  src: string;
  w: number;
  h: number;
  bg: string | null;
  colors: string[];
}

/** The colours of a drawn picture, read from a small copy. */
export function analyze(source: CanvasImageSource, w: number, h: number): { bg: string | null; colors: string[] } {
  const scale = Math.min(1, 96 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { bg: null, colors: [] };
  ctx.drawImage(source, 0, 0, cw, ch);
  const px = ctx.getImageData(0, 0, cw, ch).data;
  return { bg: edgeColor(px, cw, ch), colors: dominantColors(px, cw, ch) };
}

/** The server keeps at most 1600 px; a 5K screenshot is shrunk here first, so it travels light. */
const SEND_SIDE = 2400;
const SEND_BYTES = 8 * 1024 * 1024;

export async function readPicture(file: Blob): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const { bg, colors } = analyze(bitmap, w, h);
    let blob: Blob = file;
    if (Math.max(w, h) > SEND_SIDE || file.size > SEND_BYTES) {
      const scale = Math.min(1, SEND_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('encode'))), 'image/webp', 0.92));
    }
    return { blob, src: URL.createObjectURL(blob), w, h, bg, colors };
  } finally {
    bitmap.close();
  }
}

export class UploadError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function uploadPicture(blob: Blob): Promise<{ id: string; width: number; height: number }> {
  let res: Response;
  try {
    res = await fetch('/api/files', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
  } catch {
    throw new UploadError('offline');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new UploadError(body?.error?.code ?? 'internal');
  }
  return res.json();
}

/** Resolves once the browser has the image, so swapping a preview for it does not flash. */
export function preload(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => undefined);
}

// ───────────────────────────── a new cover, from drop to saved

const inflight = new Map<string, number>();
let runs = 0;

const UPLOAD_NOTICE: Record<string, string> = {
  too_large: 'coverTooLarge',
  limit_reached: 'coverQuota',
  invalid: 'coverUnreadable',
  offline: 'coverOffline',
  rate_limited: 'coverBusy',
};

/** Whether a picture for the column is still on its way (its framing is saved when it lands). */
export const uploadingCover = (laneId: string) => inflight.has(laneId);

/** Forgets a picture on its way: removing the cover before it lands. */
export const abandonCover = (laneId: string) => {
  inflight.delete(laneId);
  clearPreview(laneId);
};

/**
 * Shows a dropped picture at once, sends it, and saves it as the column's cover with
 * whatever framing the person gave it meanwhile. A column without a colour takes the
 * picture's main colour, in the same undo step. Survives the panel being closed.
 */
export async function takePicture(laneId: string, file: File, actions: Actions, store: WorkspaceStore): Promise<void> {
  const run = ++runs;
  inflight.set(laneId, run);
  let pic: Picture;
  try {
    pic = await readPicture(file);
  } catch {
    if (inflight.get(laneId) === run) inflight.delete(laneId);
    store.notify({ tone: 'error', key: 'coverUnreadable' });
    return;
  }
  if (inflight.get(laneId) !== run) return URL.revokeObjectURL(pic.src);
  const lane = store.getState().data?.lanes.get(laneId);
  const paint = lane && !lane.color ? pic.colors[0] : undefined;
  const bg = autoBackground(pic.bg, pic.colors, paint ?? lane?.color);
  setPreview(laneId, { cover: { src: pic.src, ...FRAME_DEFAULT, w: pic.w, h: pic.h, bg }, uploading: true, ...(paint ? { color: paint } : {}) });
  try {
    const up = await uploadPicture(pic.blob);
    await preload(fileUrl(up.id));
    if (inflight.get(laneId) !== run) return;
    const now = peekPreview(laneId);
    const f = now?.cover ?? { ...FRAME_DEFAULT, bg };
    const cur = store.getState().data?.lanes.get(laneId);
    // Paint only if the person did not pick a colour while the picture travelled.
    const color = paint && cur && !cur.color && now?.color === paint ? paint : undefined;
    actions.setCover(laneId, { fileId: up.id, x: f.x, y: f.y, z: f.z, w: up.width, h: up.height, bg: f.bg }, color);
    clearPreview(laneId, 'cover');
    clearPreview(laneId, 'uploading');
    if (color) clearPreview(laneId, 'color');
  } catch (err) {
    if (inflight.get(laneId) !== run) return;
    clearPreview(laneId);
    store.notify({ tone: 'error', key: UPLOAD_NOTICE[err instanceof UploadError ? err.code : ''] ?? 'coverFailed' });
  } finally {
    if (inflight.get(laneId) === run) inflight.delete(laneId);
    URL.revokeObjectURL(pic.src);
  }
}
