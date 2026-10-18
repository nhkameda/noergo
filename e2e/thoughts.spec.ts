import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, lane, settled, signIn } from './helpers';

const tab = (page: Page, title: string) => page.locator('.w-board-tab', { hasText: title });
const tile = (page: Page, title: string) => page.locator('.w-tile', { hasText: title });
const tiles = (page: Page) => page.locator('.w-tile__title');
const openMenu = (page: Page) => page.locator('.w-menu:popover-open');

async function newBoard(page: Page, title: string) {
  await page.getByRole('button', { name: 'New board' }).click();
  const input = page.getByRole('textbox', { name: 'Board name' });
  await input.fill(title);
  await input.press('Enter');
  await expect(tab(page, title)).toHaveAttribute('aria-current', 'page');
}

/** A pointer drag from the middle of one element to the middle of another. */
async function drag(page: Page, from: Locator, to: Locator, check?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await check?.();
  await page.mouse.up();
}

test('a card dragged onto another board’s tab moves the thought there, notes and all; ⌘Z brings it back', async ({ page }) => {
  await signIn(page, freshUser('totab'));
  await newBoard(page, 'Garden');
  await tab(page, 'My projects').click();
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(tiles(page)).toHaveText(['Inbox', 'Doing', 'Ideas']);

  await drag(page, tile(page, 'Doing'), tab(page, 'Garden'), async () => {
    // While it moves, the other board's tab says it takes it; the board it is on does not.
    await expect(tab(page, 'Garden')).toHaveAttribute('data-drop', 'over');
    await expect(tab(page, 'My projects')).not.toHaveAttribute('data-drop');
  });
  await expect(tiles(page)).toHaveText(['Inbox', 'Ideas']);
  await expect(page.locator('.w-notice').last()).toContainText('“Doing” moved to “Garden”.');
  await expect(tab(page, 'Garden')).not.toHaveAttribute('data-drop');
  await settled(page);

  await tab(page, 'Garden').click();
  await expect(tiles(page)).toHaveText(['Doing']);
  await expect(tile(page, 'Doing').locator('.w-tile__count')).toHaveText('1');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(tiles(page)).toHaveCount(0);
  await tab(page, 'My projects').click();
  await expect(tiles(page)).toHaveText(['Inbox', 'Doing', 'Ideas']);
});

test('a thought’s menu sends it to another board, and its header drags onto a tab too', async ({ page }) => {
  await signIn(page, freshUser('menumove'));
  const more = (title: string) => lane(page, title).getByRole('button', { name: `Thought “${title}”: more actions` });

  // With a single board, the menu says how to get a second one.
  await more('Ideas').click();
  await expect(openMenu(page)).toContainText('Create another board to move it there');
  await page.keyboard.press('Escape');

  await newBoard(page, 'Garden');
  await tab(page, 'My projects').click();
  await more('Ideas').click();
  await openMenu(page).getByRole('button', { name: 'Garden' }).click();
  await expect(lane(page, 'Ideas')).toHaveCount(0);

  await drag(page, lane(page, 'Doing').locator('.w-lane__title'), tab(page, 'Garden'));
  await expect(lane(page, 'Doing')).toHaveCount(0);
  await expect(page.locator('.w-lane__title')).toHaveText(['Inbox']);
  await settled(page);

  await page.reload();
  await tab(page, 'Garden').click();
  await expect(page.locator('.w-lane__title')).toHaveText(['Ideas', 'Doing']);
  await expect(lane(page, 'Doing').locator('.w-card')).toHaveText([/Mind map/]);
});

test('every card opens the mind map of its thought', async ({ page }) => {
  await signIn(page, freshUser('cardmap'));
  await page.getByRole('button', { name: 'Cards' }).click();
  await tile(page, 'Doing').getByRole('button', { name: 'Map of “Doing”' }).click();
  await expect(page.locator('.w-map')).toBeVisible();
  await expect(page.locator('.w-map__node')).toContainText(['Doing', 'Mind map']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.w-map')).toHaveCount(0);
  await expect(page.locator('.w-gallery')).toBeVisible();
});

test('on a phone, a card’s menu moves its thought to another board @mobile', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 600, 'phone layout');
  await signIn(page, freshUser('phonemove'));
  await newBoard(page, 'Garden');
  await tab(page, 'My projects').click();
  await page.getByRole('button', { name: 'Cards' }).click();
  // By touch the map and the menu are there without hovering.
  await expect(tile(page, 'Ideas').getByRole('button', { name: 'Map of “Ideas”' })).toBeVisible();
  await tile(page, 'Ideas').getByRole('button', { name: 'Thought “Ideas”: more actions' }).click();
  await expect(openMenu(page)).toBeInViewport({ ratio: 1 });
  await openMenu(page).getByRole('button', { name: 'Garden' }).click();
  await expect(tiles(page)).toHaveText(['Inbox', 'Doing']);
});
