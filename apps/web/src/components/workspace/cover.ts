import type { CSSProperties } from 'react';
import { inkOn } from './map';
import { colorName } from './model';

/**
 * Column covers and colours, without React or the DOM: the frame maths, the colours read
 * from a picture, and the CSS variables that paint a column, its notes and its map.
 */

/** Width over height of every cover frame: the column top, the card, the map corner. */
export const COVER_ASPECT = 3;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 6;

export interface Frame {
  x: number;
  y: number;
  z: number;
}
export interface Framed extends Frame {
  w: number;
  h: number;
}

/** A new cover shows the whole picture, centred. */
export const FRAME_DEFAULT: Frame = { x: 0.5, y: 0.5, z: 1 };

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Where the picture sits in its frame, in percent of the frame's width (left, width) and
 * height (top, height). At z = 1 the whole picture fits; x and y name the point of the
 * picture at the centre of the frame. Percentages, so one framing serves every size.
 */
export function coverBox(c: Framed, aspect = COVER_ASPECT): { left: number; top: number; width: number; height: number } {
  const ratio = c.w / (aspect * c.h);
  const width = Math.min(1, ratio) * c.z * 100;
  const height = Math.min(1, 1 / ratio) * c.z * 100;
  return { left: 50 - c.x * width, top: 50 - c.y * height, width, height };
}

/** The framing after dragging the picture by (dx, dy) screen pixels in a frame `frameWidth` wide. */
export function panFrame(c: Framed, dx: number, dy: number, frameWidth: number, aspect = COVER_ASPECT): Frame {
  const box = coverBox(c, aspect);
  const pw = (frameWidth * box.width) / 100;
  const ph = (frameWidth / aspect) * (box.height / 100);
  return { x: clamp01(c.x - dx / pw), y: clamp01(c.y - dy / ph), z: c.z };
}

/** The slider runs on a log scale: equal steps feel like equal zooms. */
export const zoomToSlider = (z: number) => (Math.log(clampZoom(z)) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN));
export const sliderToZoom = (s: number) => Math.round(Math.exp(Math.log(ZOOM_MIN) + clamp01(s) * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 1000) / 1000;

// ───────────────────────────── colours read from pixels (RGBA, like ImageData)

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The colour around the picture's edge, to fill the frame around it: a logo shot on white
 * then sits on white. null when the edge is transparent (the column colour shows through)
 * or too mixed to stand for a background.
 */
export function edgeColor(px: ArrayLike<number>, w: number, h: number): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let clear = 0;
  const seen: [number, number, number][] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (px[i + 3]! < 200) {
      clear++;
      return;
    }
    r += px[i]!;
    g += px[i + 1]!;
    b += px[i + 2]!;
    n++;
    seen.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    if (h > 1) take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    if (w > 1) take(w - 1, y);
  }
  if (n === 0 || clear > n) return null;
  const avg: [number, number, number] = [r / n, g / n, b / n];
  // A photo runs to its edges in many colours: no single colour stands for it.
  const far = seen.filter(([a, c, d]) => Math.abs(a - avg[0]) + Math.abs(c - avg[1]) + Math.abs(d - avg[2]) > 90).length;
  if (far / n > 0.2) return null;
  return hex(...avg);
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Up to `max` colours that stand for the picture: the most present lively hues, leaving
 * out white, black, greys and the transparent. Largest first. A black-and-white logo
 * has none.
 */
export function dominantColors(px: ArrayLike<number>, w: number, h: number, max = 3): string[] {
  const BUCKETS = 24;
  const buckets = Array.from({ length: BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0, k: 0, n: 0 }));
  let total = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    if (px[i + 3]! < 200) continue;
    total++;
    const [hue, s, l] = hsl(px[i]!, px[i + 1]!, px[i + 2]!);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue;
    const bucket = buckets[Math.floor(hue / (360 / BUCKETS)) % BUCKETS]!;
    // The most saturated pixels set the shade: anti-aliased edges, half background, do not wash it out.
    const k = s * s;
    bucket.weight += s;
    bucket.r += px[i]! * k;
    bucket.g += px[i + 1]! * k;
    bucket.b += px[i + 2]! * k;
    bucket.k += k;
    bucket.n++;
  }
  if (!total) return [];
  const out: string[] = [];
  const taken = new Set<number>();
  const order = buckets.map((b, i) => ({ ...b, i })).sort((a, b) => b.weight - a.weight);
  for (const b of order) {
    if (out.length >= max || b.n / total < 0.01) break;
    // Neighbouring hues are one colour, shaded.
    if (taken.has((b.i + 1) % BUCKETS) || taken.has((b.i + BUCKETS - 1) % BUCKETS)) continue;
    taken.add(b.i);
    out.push(hex(b.r / b.k, b.g / b.k, b.b / b.k));
  }
  return out;
}

/**
 * Whether two colours read as one: the same picture read twice (the dropped original,
 * then the copy the server keeps) gives averages a few steps apart.
 */
export function sameColor(a: string | null | undefined, b: string | null | undefined, tolerance = 24): boolean {
  if (!a || !b) return a === b;
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return pa.reduce((sum, v, i) => sum + Math.abs(v - pb[i]!), 0) <= tolerance;
}

/**
 * The background a new cover starts with. A logo shot on a colour keeps it. A transparent
 * one on a column of its own colour would vanish, so it gets white (or ink, for a light
 * logo) behind it; elsewhere it stays transparent.
 */
export function autoBackground(edge: string | null, colors: readonly string[], lane: string | null | undefined): string | null {
  if (edge) return edge;
  const main = colors[0];
  if (!main || !lane || !sameColor(main, lane, 90)) return null;
  return inkOn(main) === '#ffffff' ? '#ffffff' : '#142b45';
}

// ───────────────────────────── painting a column

/**
 * The attributes that paint an element in a content colour. Palette colours use their
 * design tokens (tuned for light and dark); any other colour — a brand colour picked by
 * the person — derives its tint and edge in CSS from --c, and carries the text that reads on it.
 */
export function corProps(color: string | null | undefined): { 'data-cor'?: string; style?: CSSProperties } {
  if (!color) return {};
  const name = colorName(color);
  return name ? { 'data-cor': name } : { 'data-cor': 'custom', style: { '--c': color, '--c-on': inkOn(color) } as CSSProperties };
}

/**
 * A coloured column: its colour as the background, text that reads on it, and (through
 * corProps) the tint its notes take. The stored colour is used in light and dark alike,
 * so the text colour computed for it always matches what is drawn.
 */
export function laneStyle(color: string | null | undefined): { 'data-cor'?: string; 'data-tinted'?: true; style?: CSSProperties } {
  if (!color) return {};
  const base = corProps(color);
  return { ...base, 'data-tinted': true, style: { ...base.style, '--lane': color, '--lane-on': inkOn(color) } as CSSProperties };
}

/** One or two letters for a column without a cover, from the words of its title. */
const SMALL_WORDS = /^(de|da|do|das|dos|e|em|a|o|of|the|and|for|to|com|br|org|net|io|app)$/i;

export function initials(title: string): string {
  const words = title
    .replace(/https?:\/\//i, '')
    .split(/[\s._\-/]+/u)
    .filter(Boolean);
  const first = [...(words[0] ?? '')][0] ?? '';
  // CJK titles: one character says enough.
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(first)) return first;
  // Numbers and small words ("2026", "de", ".com") do not make an initial.
  const next = words.slice(1).find((w) => !SMALL_WORDS.test(w) && !/^\d+$/.test(w));
  const second = next ? ([...next][0] ?? '') : '';
  return (first + second).toUpperCase();
}
