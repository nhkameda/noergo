import { describe, expect, it } from 'vitest';
import { autoBackground, corProps, coverBox, dominantColors, edgeColor, initials, laneStyle, panFrame, sameColor, sliderToZoom, ZOOM_MAX, ZOOM_MIN, zoomToSlider } from '@/components/workspace/cover';
import { PALETTE } from '@/components/workspace/model';

/** An RGBA picture `w` × `h` painted by `at(x, y)`. */
function picture(w: number, h: number, at: (x: number, y: number) => [number, number, number, number?]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = at(x, y);
      px.set([r, g, b, a], (y * w + x) * 4);
    }
  return px;
}

describe('cover framing', () => {
  it('fits a picture of the frame’s own shape exactly at z = 1', () => {
    expect(coverBox({ x: 0.5, y: 0.5, z: 1, w: 300, h: 100 })).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('shows the whole of a square logo, centred, at z = 1', () => {
    const box = coverBox({ x: 0.5, y: 0.5, z: 1, w: 200, h: 200 });
    expect(box.height).toBe(100);
    expect(box.width).toBeCloseTo(100 / 3);
    expect(box.left).toBeCloseTo(50 - 100 / 6);
    expect(box.top).toBe(0);
  });

  it('shows the whole of a wide banner, centred, at z = 1', () => {
    const box = coverBox({ x: 0.5, y: 0.5, z: 1, w: 600, h: 100 });
    expect(box.width).toBe(100);
    expect(box.height).toBeCloseTo(50);
    expect(box.top).toBeCloseTo(25);
  });

  it('puts the point (x, y) of the picture at the centre of the frame', () => {
    const c = { x: 0.2, y: 0.8, z: 2.5, w: 400, h: 300 };
    const box = coverBox(c);
    expect(box.left + c.x * box.width).toBeCloseTo(50);
    expect(box.top + c.y * box.height).toBeCloseTo(50);
  });

  it('follows the pointer: dragging right shows more of the left of the picture', () => {
    const c = { x: 0.5, y: 0.5, z: 2, w: 300, h: 100 };
    const moved = panFrame(c, 60, 0, 300);
    // The picture is 600 px wide in a 300 px frame: 60 px is a tenth of it.
    expect(moved.x).toBeCloseTo(0.4);
    expect(moved.y).toBe(0.5);
    const box = coverBox({ ...c, ...moved });
    expect((box.left - coverBox(c).left) * 3).toBeCloseTo(60);
  });

  it('never pans the picture off its frame centre', () => {
    const c = { x: 0.5, y: 0.5, z: 1, w: 300, h: 100 };
    expect(panFrame(c, -10_000, 10_000, 300)).toEqual({ x: 1, y: 0, z: 1 });
  });

  it('runs the zoom slider on a log scale, both ways', () => {
    expect(zoomToSlider(ZOOM_MIN)).toBe(0);
    expect(zoomToSlider(ZOOM_MAX)).toBe(1);
    for (const z of [0.3, 0.5, 1, 1.7, 3, 6]) expect(sliderToZoom(zoomToSlider(z))).toBeCloseTo(z, 2);
    expect(zoomToSlider(100)).toBe(1);
    expect(sliderToZoom(-1)).toBe(ZOOM_MIN);
  });
});

describe('colours read from a picture', () => {
  it('finds the background a logo was shot on', () => {
    const px = picture(20, 10, (x, y) => (x > 5 && x < 14 && y > 2 && y < 7 ? [120, 40, 200] : [255, 255, 255]));
    expect(edgeColor(px, 20, 10)).toBe('#ffffff');
  });

  it('has no background for a transparent PNG', () => {
    const px = picture(20, 10, (x, y) => (x > 5 && x < 14 && y > 2 && y < 7 ? [120, 40, 200, 255] : [0, 0, 0, 0]));
    expect(edgeColor(px, 20, 10)).toBeNull();
  });

  it('has no background for a photo whose edges are many colours', () => {
    const px = picture(20, 10, (x) => (x % 2 ? [250, 20, 20] : [20, 20, 250]));
    expect(edgeColor(px, 20, 10)).toBeNull();
  });

  it('names the main lively colour first and leaves out white and greys', () => {
    const px = picture(30, 10, (x) => (x < 10 ? [255, 255, 255] : x < 22 ? [124, 58, 237] : x < 26 ? [128, 128, 128] : [245, 158, 11]));
    const colors = dominantColors(px, 30, 10);
    expect(colors[0]).toBe('#7c3aed');
    expect(colors).toContain('#f59e0b');
    expect(colors).toHaveLength(2);
  });

  it('has no colour to offer for a black-and-white logo', () => {
    const px = picture(10, 10, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
    expect(dominantColors(px, 10, 10)).toEqual([]);
  });

  it('takes neighbouring shades of one hue as one colour', () => {
    const px = picture(20, 10, (x) => (x < 10 ? [124, 58, 237] : [140, 60, 240]));
    expect(dominantColors(px, 20, 10)).toHaveLength(1);
  });
});

describe('the same colour read twice', () => {
  it('is one colour a few steps apart, not across hues', () => {
    expect(sameColor('#7d3bed', '#8447ee')).toBe(true);
    expect(sameColor('#7c3aed', '#0e9f6e')).toBe(false);
    expect(sameColor(null, null)).toBe(true);
    expect(sameColor('#7c3aed', null)).toBe(false);
  });
});

describe('the background a new cover starts with', () => {
  it('keeps the colour a logo was shot on', () => {
    expect(autoBackground('#ffffff', ['#7c3aed'], '#7c3aed')).toBe('#ffffff');
  });

  it('puts white behind a transparent dark logo on a column of its own colour', () => {
    expect(autoBackground(null, ['#0b7dda'], '#0d80dd')).toBe('#ffffff');
    expect(autoBackground(null, ['#ffd84a'], '#ffc83d')).toBe('#142b45');
  });

  it('leaves a transparent logo transparent on another colour, or none', () => {
    expect(autoBackground(null, ['#0b7dda'], '#ffc83d')).toBeNull();
    expect(autoBackground(null, ['#0b7dda'], null)).toBeNull();
    expect(autoBackground(null, [], '#0b7dda')).toBeNull();
  });
});

describe('painting a column', () => {
  it('uses the design token for a palette colour', () => {
    const anil = PALETTE.find((c) => c.name === 'anil')!;
    expect(corProps(anil.hex)).toEqual({ 'data-cor': 'anil' });
  });

  it('carries any other colour itself, with the text that reads on it', () => {
    expect(corProps('#7c3aed')).toEqual({ 'data-cor': 'custom', style: { '--c': '#7c3aed', '--c-on': '#ffffff' } });
    expect(corProps('#fde68a').style).toMatchObject({ '--c-on': '#142b45' });
  });

  it('paints nothing without a colour', () => {
    expect(corProps(null)).toEqual({});
    expect(laneStyle(null)).toEqual({});
  });

  it('makes the colour the column, with its readable text', () => {
    const s = laneStyle('#7c3aed');
    expect(s['data-tinted']).toBe(true);
    expect(s['data-cor']).toBe('custom');
    expect(s.style).toMatchObject({ '--lane': '#7c3aed', '--lane-on': '#ffffff', '--c': '#7c3aed' });
  });
});

describe('initials of a column without a cover', () => {
  it.each([
    ['atelier.com', 'A'],
    ['example.com', 'E'],
    ['https://example.com.br', 'E'],
    ['Ideias soltas', 'IS'],
    ['projeto-x', 'PX'],
    ['Livros 2026', 'L'],
    ['Curso de IA', 'CI'],
    ['日本語', '日'],
    ['', ''],
  ])('%s → %s', (title, expected) => {
    expect(initials(title)).toBe(expected);
  });
});
