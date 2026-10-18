import { describe, expect, it } from 'vitest';
import { MAP_ZOOM } from '@/components/workspace/map';
import { anchoredScroll, CARDS, cardsThatFit, columnsZoom, fromLogSlider, perRow, toLogSlider } from '@/components/workspace/view-prefs';

describe('cards per row', () => {
  it('fits as many readable cards as the width allows, and at least one', () => {
    // 1440 px window: 1408 px of grid, 12 px apart.
    expect(cardsThatFit(1408, 12)).toBe(CARDS.max);
    // A phone: 366 px, 8 px apart.
    expect(cardsThatFit(366, 8)).toBe(3);
    expect(cardsThatFit(96, 8)).toBe(1);
    expect(cardsThatFit(0, 8)).toBe(1);
  });

  it('keeps a choice whole and within its range', () => {
    expect(perRow(6.4)).toBe(6);
    expect(perRow(0)).toBe(CARDS.min);
    expect(perRow(40)).toBe(CARDS.max);
  });
});

describe('the size of the columns', () => {
  it('stays between 50 % and 150 %', () => {
    expect(columnsZoom(0.1)).toBe(0.5);
    expect(columnsZoom(9)).toBe(1.5);
    expect(columnsZoom(0.98765)).toBe(0.988);
  });

  it('keeps what is under the pointer in place', () => {
    // 300 px scrolled, pointer 200 px in: that content was at 500; at twice the size it is at 1000.
    expect(anchoredScroll(300, 200, 2)).toBe(800);
    expect(anchoredScroll(300, 0, 0.5)).toBe(150);
    expect(anchoredScroll(0, 400, 0.5)).toBe(0);
  });
});

describe('the map’s zoom slider', () => {
  it('runs on a log scale, both ways, with 100 % past the middle', () => {
    expect(toLogSlider(MAP_ZOOM.min, MAP_ZOOM.min, MAP_ZOOM.max)).toBe(0);
    expect(toLogSlider(MAP_ZOOM.max, MAP_ZOOM.min, MAP_ZOOM.max)).toBe(1);
    for (const z of [0.2, 0.5, 1, 2, 2.8]) expect(fromLogSlider(toLogSlider(z, MAP_ZOOM.min, MAP_ZOOM.max), MAP_ZOOM.min, MAP_ZOOM.max)).toBeCloseTo(z, 6);
    // Halfway is the geometric middle: as many steps out as in.
    expect(fromLogSlider(0.5, MAP_ZOOM.min, MAP_ZOOM.max)).toBeCloseTo(Math.sqrt(MAP_ZOOM.min * MAP_ZOOM.max), 6);
    expect(toLogSlider(1, MAP_ZOOM.min, MAP_ZOOM.max)).toBeGreaterThan(0.5);
  });
});
