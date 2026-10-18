import { expect, test, type Page } from '@playwright/test';
import { card, freshUser, lane, settled, signIn } from './helpers';

/** How many tracks the cards grid lays out (one per card of a full row). */
const perRow = (page: Page) => page.locator('.w-gallery__grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
const width = (page: Page, title: string) => lane(page, title).evaluate((el) => el.getBoundingClientRect().width);
const foot = (page: Page) => page.locator('.w-foot');

/** A trackpad pinch: the browser sends it as a wheel with Ctrl held. */
async function pinch(page: Page, over: { x: number; y: number }, deltaY: number) {
  await page.mouse.move(over.x, over.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

test('cards: six a row, the slider and a pinch change how many, and the choice stays', async ({ page }) => {
  await signIn(page, freshUser('rows'));
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(foot(page)).toContainText('3 columns · ');
  expect(await perRow(page)).toBe(6);
  const slider = foot(page).getByRole('slider', { name: 'Card size' });
  await expect(slider).toHaveAttribute('aria-valuetext', '6 cards per row');

  // To the right the cards grow: fewer a row.
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '5 cards per row');
  expect(await perRow(page)).toBe(5);
  const big = (await page.locator('.w-tile').first().boundingBox())!.width;
  await foot(page).getByRole('button', { name: 'Smaller' }).click();
  await foot(page).getByRole('button', { name: 'Smaller' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', '7 cards per row');
  expect((await page.locator('.w-tile').first().boundingBox())!.width).toBeLessThan(big * 0.8);

  // Pinching in (fingers together) shows more cards.
  const grid = (await page.locator('.w-gallery').boundingBox())!;
  await pinch(page, { x: grid.x + grid.width / 2, y: grid.y + 100 }, 60);
  await expect(slider).toHaveAttribute('aria-valuetext', '8 cards per row');
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  await page.reload();
  await expect.poll(() => perRow(page)).toBe(8);
});

test('columns: the slider and a pinch scale them; menus and drags still land where they should', async ({ page }) => {
  await signIn(page, freshUser('scale'));
  const slider = foot(page).getByRole('slider', { name: 'Column size' });
  await expect(slider).toHaveAttribute('aria-valuetext', '100%');
  const full = await width(page, 'Inbox');

  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '90%');
  await foot(page).getByRole('button', { name: 'Smaller' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', '80%');
  expect(await width(page, 'Inbox')).toBeCloseTo(full * 0.8, 0);

  // A column's menu opens at full size, next to its button.
  const more = lane(page, 'Doing').getByRole('button', { name: 'Column “Doing”: more actions' });
  await more.click();
  const menu = page.locator('.w-menu:popover-open');
  await expect(menu).toBeVisible();
  const b = (await more.boundingBox())!;
  // The menu is placed on the next frame: wait for it to settle under its button.
  await expect.poll(async () => Math.abs(((await menu.boundingBox())?.y ?? 0) - (b.y + b.height + 4))).toBeLessThan(2);
  const m = (await menu.boundingBox())!;
  expect(m.width).toBeGreaterThanOrEqual(232);
  expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThan(2);
  await page.keyboard.press('Escape');

  // Drags work at this size too.
  await card(page, 'Connect an agent').dragTo(lane(page, 'Doing').locator('.w-card').first(), { targetPosition: { x: 30, y: 3 } });
  await expect(lane(page, 'Doing').locator('.w-card').first()).toContainText('Connect an agent');

  // Pinching out (fingers apart) grows them, up to 150 %.
  const board = (await page.locator('.w-board').boundingBox())!;
  await pinch(page, { x: board.x + 200, y: board.y + 200 }, -200);
  await expect(slider).toHaveAttribute('aria-valuetext', '150%');
  expect(await width(page, 'Inbox')).toBeCloseTo(full * 1.5, 0);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await settled(page);

  await page.reload();
  await expect(slider).toHaveAttribute('aria-valuetext', '150%');
  await expect.poll(() => width(page, 'Inbox')).toBeCloseTo(full * 1.5, 0);
});

test('the map: the slider zooms, and follows the buttons and the wheel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('mapzoom'));
  await lane(page, 'Inbox').getByRole('button', { name: 'Map of “Inbox”' }).click();
  const map = page.locator('.w-map');
  const slider = map.getByRole('slider', { name: 'Map zoom' });
  const label = map.locator('.w-map__zoom-label');

  await slider.fill('1');
  await expect(label).toHaveText('300%');
  await expect(slider).toHaveAttribute('aria-valuetext', '300%');
  await slider.fill('0');
  await expect(label).toHaveText('15%');

  await map.getByRole('button', { name: 'Zoom to 100%' }).click();
  await expect(label).toHaveText('100%');
  const at100 = Number(await slider.inputValue());
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await expect(label).toHaveText('125%');
  expect(Number(await slider.inputValue())).toBeGreaterThan(at100);

  const c = (await map.locator('.w-map__canvas').boundingBox())!;
  await pinch(page, { x: c.x + c.width / 2, y: c.y + c.height / 2 }, 120);
  expect(Number(await slider.inputValue())).toBeLessThan(at100);
});

test('on a phone: three cards a row at most, and smaller columns show two at once @mobile', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 600, 'phone layout');
  await signIn(page, freshUser('phonezoom'));
  await expect(foot(page)).toBeInViewport();
  const slider = foot(page).getByRole('slider', { name: 'Column size' });
  await slider.fill('0.5');
  await expect(slider).toHaveAttribute('aria-valuetext', '50%');
  const doing = (await lane(page, 'Doing').boundingBox())!;
  expect(doing.x + doing.width).toBeLessThan(390);

  await page.getByRole('button', { name: 'Cards' }).click();
  // From the first frame: never six squeezed on a phone.
  expect(await perRow(page)).toBe(3);
  await expect(foot(page).getByRole('slider', { name: 'Card size' })).toHaveAttribute('aria-valuetext', '3 cards per row');
});
