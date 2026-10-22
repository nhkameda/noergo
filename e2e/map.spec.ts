import { expect, test, type Locator, type Page } from '@playwright/test';
import { card, freshUser, lane, settled, signIn } from './helpers';

const openInboxMap = async (page: Page) => {
  await lane(page, 'Inbox').getByRole('button', { name: 'Map of “Inbox”' }).click();
  await expect(page.locator('.w-map').getByRole('heading', { name: 'Inbox' })).toBeVisible();
};
const node = (page: Page, text: string) => page.locator('.w-map__node', { hasText: text });
/** Where a node sits on the map, in map units: the screen position also depends on the zoom. */
const spot = (l: Locator) => l.evaluate((el) => [parseFloat(el.style.left), parseFloat(el.style.top)]);

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
  const before = await spot(node(page, 'Barista'));

  await page.reload();
  await expect(node(page, 'Barista')).toBeVisible();
  await expect(page.locator('.w-map__edge')).toHaveCount(2);
  await expect(page.locator('.w-map__head')).toHaveCount(2);
  expect(await spot(node(page, 'Barista'))).toEqual(before);

  // Esc with nothing selected: back to the board, where the new notes are cards.
  await page.locator('.w-map__canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.w-map')).toHaveCount(0);
  await expect(card(page, 'Barista')).toBeVisible();
});

test('an idea’s text: a glance under the mouse, the whole of it in the panel beside the map', async ({ page }) => {
  await signIn(page, freshUser('ines'));
  await openInboxMap(page);

  // Resting the mouse on an idea shows its text, and leaving it hides it.
  await node(page, 'Quick capture').hover();
  const peek = page.locator('.w-map__peek');
  await expect(peek).toContainText('The capture bar drops everything into this thought.');
  await page.mouse.move(5, 5);
  await expect(peek).toHaveCount(0);

  // A click opens the panel: the text, the details and every style tool.
  await node(page, 'Welcome to noergo').click();
  const side = page.getByRole('complementary', { name: 'The selection' });
  await expect(side).toContainText('Write the way you think.');
  await expect(side.getByRole('textbox', { name: 'Title' })).toHaveValue('Welcome to noergo');
  await side.getByRole('toolbar', { name: 'Style of the selection' }).getByRole('button', { name: 'Diamond' }).click();
  await expect(node(page, 'Welcome to noergo')).toHaveAttribute('data-shape', 'diamond');

  // A click on the empty canvas closes it.
  const canvas = (await page.locator('.w-map__canvas').boundingBox())!;
  await page.mouse.click(canvas.x + 40, canvas.y + canvas.height - 40);
  await expect(side).toHaveCount(0);
});

test('folding a branch: a red count, it travels with its idea, it stays folded, and two parents keep it open', async ({ page }) => {
  // The view lands at once when it is fitted.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('fold'));
  await openInboxMap(page);
  const top = node(page, 'Welcome to noergo');
  for (const name of ['Extrusion', 'CNC', 'Anodising']) {
    await top.click();
    await page.keyboard.press('Tab');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(node(page, name)).toBeVisible();
  }

  // Folded from the panel: the branch goes, a count of it stays.
  const start = { top: await spot(top), cnc: await spot(node(page, 'CNC')) };
  await top.click();
  const side = page.getByRole('complementary', { name: 'The selection' });
  await side.getByRole('button', { name: /^Fold the ideas below/ }).click();
  await expect(node(page, 'CNC')).toHaveCount(0);
  await expect(page.locator('.w-map__edge')).toHaveCount(0);
  const badge = top.getByRole('button', { name: '3 ideas folded inside. Show' });
  await expect(badge).toHaveText('3');

  // Dragged while folded: the branch goes along, unseen.
  const b = (await top.locator('.w-map__text').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await settled(page);

  // Kept: after a reload it is still folded; ⌘/Ctrl + . opens it where it now belongs.
  await page.reload();
  await expect(badge).toHaveText('3');
  await expect(node(page, 'CNC')).toHaveCount(0);
  await top.click();
  await page.keyboard.press('ControlOrMeta+.');
  await expect(node(page, 'CNC')).toBeVisible();
  await expect(top.locator('.w-map__fold')).not.toHaveAttribute('aria-label', /folded inside/);
  const [tx, ty] = await spot(top);
  const [cx, cy] = await spot(node(page, 'CNC'));
  expect(tx! - start.top[0]!).toBeGreaterThan(20);
  expect(Math.abs(cx! - start.cnc[0]! - (tx! - start.top[0]!))).toBeLessThanOrEqual(1);
  expect(Math.abs(cy! - start.cnc[1]! - (ty! - start.top[1]!))).toBeLessThanOrEqual(1);
  // Folded again and opened by its count: nothing moves.
  await page.keyboard.press('ControlOrMeta+.');
  await expect(node(page, 'CNC')).toHaveCount(0);
  await badge.click();
  expect(await spot(node(page, 'CNC'))).toEqual([cx, cy]);

  // CNC linked from a second idea: the branch can no longer fold, and the panel says why.
  await page.keyboard.press('Escape');
  await page.locator('.w-map__zoom').getByRole('button', { name: 'Fit to screen' }).click();
  await connect(page, node(page, 'Quick capture'), node(page, 'CNC'));
  await expect(page.locator('.w-map__edge')).toHaveCount(4);
  await top.click();
  await expect(side.getByRole('button', { name: /^Fold the ideas below/ })).toBeDisabled();
  await expect(side).toContainText('“CNC” is linked to more than one idea above it');
  await expect(top.locator('.w-map__fold')).toHaveCount(0);
  await expect(page.locator('.w-map__bar').getByRole('button', { name: 'Fold all' })).toHaveCount(0);
});

test('columns and the map work alike: one panel that a blank click, Esc or another view closes, one colour per idea', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('alike'));
  const drawer = page.getByRole('dialog', { name: 'Welcome to noergo' });
  const welcome = card(page, 'Welcome to noergo');

  // A card opens its note; a click on the empty column closes it, and so does Esc.
  await welcome.click();
  await expect(drawer).toBeVisible();
  const empty = (await lane(page, 'Inbox').locator('.w-cards').boundingBox())!;
  await page.mouse.click(empty.x + empty.width / 2, empty.y + empty.height - 12);
  await expect(drawer).toHaveCount(0);
  await welcome.click();
  await welcome.focus();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Another view closes it too: here the column's map.
  await welcome.click();
  await expect(drawer).toBeVisible();
  await openInboxMap(page);
  await expect(drawer).toHaveCount(0);

  // On the map an idea's colour is its note's. A note opened from the panel gives way to a
  // click on the canvas, like the panel.
  await node(page, 'Welcome to noergo').click();
  const side = page.getByRole('complementary', { name: 'The selection' });
  await side.getByRole('radio', { name: 'Annatto red' }).click();
  await side.getByRole('button', { name: 'Open note' }).click();
  await expect(drawer).toBeVisible();
  const canvas = (await page.locator('.w-map__canvas').boundingBox())!;
  await page.mouse.click(canvas.x + 40, canvas.y + canvas.height - 40);
  await expect(drawer).toHaveCount(0);
  await expect(side).toHaveCount(0);

  // The view switcher leaves the map; the card wears the colour given there.
  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(page.locator('.w-map')).toHaveCount(0);
  await expect(welcome).toHaveAttribute('data-cor', 'urucum');

  // The column's panel hangs a new idea from the note and folds it, as the map's does.
  await welcome.click();
  await drawer.getByRole('textbox', { name: 'New idea below' }).fill('Extrusion');
  await page.keyboard.press('Enter');
  await expect(page.locator('.w-card-slot', { has: card(page, 'Extrusion') })).toHaveAttribute('data-depth', '1');
  await drawer.getByRole('button', { name: /^Fold the ideas below/ }).click();
  await expect(card(page, 'Extrusion')).toHaveCount(0);
  await expect(welcome.getByRole('button', { name: '1 idea folded inside. Show' })).toHaveText('1');
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
