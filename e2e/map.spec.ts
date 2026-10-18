import { expect, test, type Locator, type Page } from '@playwright/test';
import { card, freshUser, lane, settled, signIn } from './helpers';

const openInboxMap = async (page: Page) => {
  await lane(page, 'Inbox').getByRole('button', { name: 'Map of “Inbox”' }).click();
  await expect(page.locator('.w-map').getByRole('heading', { name: 'Inbox' })).toBeVisible();
};
const node = (page: Page, text: string) => page.locator('.w-map__node', { hasText: text });

/** Drags from the right-hand dot of `from` and lets go over `to`. */
async function connect(page: Page, from: Locator, to: Locator) {
  await from.hover();
  const h = (await from.locator('[data-handle="e"]').boundingBox())!;
  const t = (await to.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('the map of a column: create, connect, style, organise, and it survives a reload', async ({ page }) => {
  // "Organise" then lands at once instead of animating.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('cai'));
  await openInboxMap(page);
  await expect(page).toHaveURL(/#map=/);
  await expect(node(page, 'Welcome to noergo')).toBeVisible();
  await expect(node(page, 'Quick capture')).toBeVisible();

  // Double-click on empty canvas: a new thought, typed in place.
  const canvas = (await page.locator('.w-map__canvas').boundingBox())!;
  await page.mouse.dblclick(canvas.x + 60, canvas.y + 60);
  await page.keyboard.type('Oat milk');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Oat milk')).toBeVisible();

  // From the column to it.
  await connect(page, page.locator('.w-map__node[data-root]'), node(page, 'Oat milk'));
  await expect(page.locator('.w-map__edge')).toHaveCount(1);
  const bar = page.getByRole('toolbar', { name: 'Style of the selection' });
  await bar.getByRole('button', { name: 'At the end' }).click();
  await expect(page.locator('.w-map__head')).toHaveCount(1);

  // Tab: a linked thought.
  await node(page, 'Oat milk').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Barista');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Barista')).toBeVisible();
  await expect(page.locator('.w-map__edge')).toHaveCount(2);
  // A new link takes the style of the last one changed.
  await expect(page.locator('.w-map__head')).toHaveCount(2);

  // Linking the same two again only selects the link there is.
  await connect(page, node(page, 'Oat milk'), node(page, 'Barista'));
  await expect(page.getByText('These two are already linked.')).toBeVisible();
  await expect(page.locator('.w-map__edge')).toHaveCount(2);

  await page.getByRole('button', { name: 'Organise' }).click();
  await settled(page);
  const before = await node(page, 'Barista').boundingBox();

  await page.reload();
  await expect(node(page, 'Barista')).toBeVisible();
  await expect(page.locator('.w-map__edge')).toHaveCount(2);
  await expect(page.locator('.w-map__head')).toHaveCount(2);
  expect(Math.abs((await node(page, 'Barista').boundingBox())!.x - before!.x)).toBeLessThan(3);

  // Esc with nothing selected: back to the board, where the new notes are cards.
  await page.locator('.w-map__canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.w-map')).toHaveCount(0);
  await expect(card(page, 'Barista')).toBeVisible();
});

test('deleting from the map goes to the trash and undoes', async ({ page }) => {
  await signIn(page, freshUser('dora'));
  await openInboxMap(page);
  await node(page, 'Quick capture').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Quick capture')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(node(page, 'Quick capture')).toBeVisible();
  // Back closes the map.
  await page.goBack();
  await expect(page.locator('.w-map')).toHaveCount(0);
  await expect(page.locator('.w-board')).toBeVisible();
});

test('the map on a phone @mobile', async ({ page, hasTouch }) => {
  const press = (l: Locator) => (hasTouch ? l.tap() : l.click());
  await signIn(page, freshUser('eli'));
  await openInboxMap(page);
  await expect(node(page, 'Welcome to noergo')).toBeInViewport();
  await press(node(page, 'Welcome to noergo'));
  const bar = page.getByRole('toolbar', { name: 'Style of the selection' });
  await expect(bar).toBeVisible();
  await press(bar.getByRole('button', { name: 'Diamond' }));
  await expect(node(page, 'Welcome to noergo')).toHaveAttribute('data-shape', 'diamond');
  await press(page.getByRole('button', { name: 'Back to the board' }));
  await expect(page.locator('.w-map')).toHaveCount(0);
});
