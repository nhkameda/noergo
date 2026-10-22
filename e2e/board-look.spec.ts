import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, newBoard, settled, signIn } from './helpers';

const tab = (page: Page, title: string) => page.locator('.w-board-tab', { hasText: title });
const titles = (page: Page) => page.locator('.w-board-tab__title');
const glyph = (page: Page, title: string) => tab(page, title).locator('.w-board-glyph');

/** A pointer drag from the middle of one tab onto one side of another. */
async function dragTo(page: Page, from: Locator, to: Locator, side: 'left' | 'right', check?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (side === 'left' ? 0.2 : 0.8), b.y + b.height / 2, { steps: 12 });
  await check?.();
  await page.mouse.up();
}

async function openLook(page: Page, title: string) {
  await page.getByRole('button', { name: `Board “${title}”: more actions` }).click();
  await page.getByRole('button', { name: 'Icon and colours…' }).click();
  const panel = page.getByRole('dialog', { name: `Customise board ${title}` });
  await expect(panel).toBeVisible();
  return panel;
}

test('board tabs change places by drag, by Alt + arrows and from the menu, and keep the order', async ({ page }) => {
  await signIn(page, freshUser('tabs'), 'en', { layout: 'cards' });
  await newBoard(page, 'Garden');
  await newBoard(page, 'Travel');
  await expect(titles(page)).toHaveText(['My projects', 'Garden', 'Travel']);

  await dragTo(page, tab(page, 'Travel'), tab(page, 'My projects'), 'left', async () => {
    await expect(tab(page, 'My projects')).toHaveAttribute('data-edge', 'left');
    await expect(tab(page, 'Travel')).toHaveClass(/w-board-tab--dragging/);
  });
  await expect(titles(page)).toHaveText(['Travel', 'My projects', 'Garden']);
  await expect(tab(page, 'My projects')).not.toHaveAttribute('data-edge');
  await expect(page.locator('.w-sr[role="status"]')).toHaveText('Board moved to position 1 of 3.');
  await settled(page);
  await page.reload();
  await expect(titles(page)).toHaveText(['Travel', 'My projects', 'Garden']);

  // Alt + arrows move the focused tab, which keeps the focus; ⌘Z puts it back.
  await tab(page, 'Travel').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(titles(page)).toHaveText(['My projects', 'Travel', 'Garden']);
  await expect(tab(page, 'Travel')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(titles(page)).toHaveText(['Travel', 'My projects', 'Garden']);

  // The open board's menu, where the first tab cannot go further left.
  await page.getByRole('button', { name: 'Board “Travel”: more actions' }).click();
  await expect(page.getByRole('button', { name: 'Move left' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move right' }).click();
  await expect(titles(page)).toHaveText(['My projects', 'Travel', 'Garden']);
  await settled(page);
  await page.reload();
  await expect(titles(page)).toHaveText(['My projects', 'Travel', 'Garden']);
});

test('a board wears an emoji or a line icon, a tab colour and a background, and keeps them', async ({ page }) => {
  await signIn(page, freshUser('look'), 'en', { layout: 'cards' });
  const panel = await openLook(page, 'My projects');
  const icons = panel.getByRole('radiogroup', { name: 'Icon' });
  // Opened from a menu, the panel takes the focus: the icon the board wears now.
  await expect(icons.getByRole('radio', { name: 'No icon' })).toBeFocused();

  await icons.getByRole('radio', { name: '🚀' }).click();
  await expect(glyph(page, 'My projects')).toHaveText('🚀');
  // The icon is decoration: the tab is still called by its name.
  await expect(tab(page, 'My projects')).toHaveAccessibleName('My projects');

  const other = panel.getByRole('textbox', { name: 'Another emoji' });
  await other.fill('abc');
  await expect(panel.getByText('That isn’t an emoji. Type or paste just one.')).toBeVisible();
  // Typed without its emoji selector, the heart still becomes the emoji.
  await other.fill('❤');
  await expect(glyph(page, 'My projects')).toHaveText('❤️');
  await expect(other).toHaveValue('');
  // One that is not on the list stays in sight, chosen.
  await other.fill('🦜');
  await expect(icons.getByRole('radio', { name: '🦜' })).toHaveAttribute('aria-checked', 'true');

  await icons.getByRole('radio', { name: 'Nature' }).click();
  await expect(glyph(page, 'My projects').locator('svg')).toBeVisible();

  await panel.getByRole('radiogroup', { name: 'Tab colour' }).getByRole('radio', { name: 'Lagoon blue' }).click();
  await expect(tab(page, 'My projects')).toHaveCSS('background-color', 'rgb(23, 179, 209)');
  await panel.getByRole('radiogroup', { name: 'Board background' }).getByRole('radio', { name: 'Sprout green' }).click();
  await expect(page.locator('.w-app')).toHaveAttribute('data-backdrop', '');
  // Each choice is its own step: ⌘Z takes back the background and leaves the tab colour.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.w-app')).not.toHaveAttribute('data-backdrop');
  await expect(tab(page, 'My projects')).toHaveAttribute('data-colored', 'true');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.w-app')).toHaveAttribute('data-backdrop', '');
  const washed = await page.locator('.w-app').evaluate((el) => getComputedStyle(el).backgroundColor);

  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();
  await settled(page);
  await page.reload();
  await expect(glyph(page, 'My projects').locator('svg')).toBeVisible();
  await expect(tab(page, 'My projects')).toHaveCSS('background-color', 'rgb(23, 179, 209)');
  await expect(page.locator('.w-app')).toHaveCSS('background-color', washed);

  // Columns show it too; the due dates (every board at once) do not.
  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(page.locator('.w-app')).toHaveAttribute('data-backdrop', '');
  await page.getByRole('button', { name: 'Due' }).click();
  await expect(page.locator('.w-app')).not.toHaveAttribute('data-backdrop');
});

test('on a phone the board menu moves the tab and the panel is a sheet @mobile', async ({ page }) => {
  await signIn(page, freshUser('tabsm'), 'en', { layout: 'cards' });
  await newBoard(page, 'Garden');
  await page.getByRole('button', { name: 'Board “Garden”: more actions' }).click();
  await page.getByRole('button', { name: 'Move left' }).click();
  await expect(titles(page)).toHaveText(['Garden', 'My projects']);

  const panel = await openLook(page, 'Garden');
  const { width, height } = page.viewportSize()!;
  // On a phone it rises from the bottom edge (measured once it has finished rising).
  if (width < 700) await expect.poll(async () => panel.boundingBox().then((b) => Math.round(b!.y + b!.height))).toBe(height);
  await panel.getByRole('radiogroup', { name: 'Icon' }).getByRole('radio', { name: '🌱' }).click();
  await expect(glyph(page, 'Garden')).toHaveText('🌱');
  await settled(page);
  await page.reload();
  await expect(titles(page)).toHaveText(['Garden', 'My projects']);
  await expect(glyph(page, 'Garden')).toHaveText('🌱');
});

/** Whether a tab shows whole inside the strip of tabs. */
async function inSight(page: Page, title: string) {
  const strip = (await page.getByRole('navigation', { name: 'Boards' }).boundingBox())!;
  const t = (await tab(page, title).boundingBox())!;
  return t.x >= strip.x - 1 && t.x + t.width <= strip.x + strip.width + 1;
}
const scrolled = (page: Page) => page.getByRole('navigation', { name: 'Boards' }).evaluate((el) => el.scrollLeft);

test('the top bar is the boards and the account; the views and tools sit along the bottom', async ({ page }) => {
  await signIn(page, freshUser('bars'));
  const top = page.getByRole('banner');
  await expect(top.getByRole('button', { name: 'Account' })).toBeVisible();
  for (const name of ['Search', 'Undo', 'Cards']) await expect(top.getByRole('button', { name })).toHaveCount(0);
  const foot = page.locator('.w-foot');
  const views = foot.getByRole('group', { name: 'View' });
  for (const name of ['Search', 'Undo', 'Redo', 'Hide done notes']) await expect(foot.getByRole('button', { name })).toBeVisible();
  const v = (await views.boundingBox())!;
  const { height } = page.viewportSize()!;
  expect(v.x).toBeLessThan(40);
  expect(v.y + v.height).toBeGreaterThan(height - 60);
  // The columns' counts and size slider share that bar, on its right.
  await expect(foot.getByRole('slider', { name: 'Column size' })).toBeVisible();
  // Few boards: no list of them, no arrows.
  await expect(page.getByRole('button', { name: /^All boards/ })).toBeHidden();
  await expect(page.getByRole('button', { name: /Show the boards to/ })).toHaveCount(0);
});

test('many boards: the arrows, the wheel and the list reach every tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('manytabs'), 'en', { layout: 'cards' });
  const titlesOf = Array.from({ length: 16 }, (_, i) => `Board ${String(i + 1).padStart(2, '0')}`);
  for (const title of titlesOf) await newBoard(page, title);

  // The new board's tab is in sight; the first ones are past the left edge.
  const back = page.getByRole('button', { name: 'Show the boards to the left' });
  const forward = page.getByRole('button', { name: 'Show the boards to the right' });
  expect(await inSight(page, 'Board 16')).toBe(true);
  expect(await inSight(page, 'My projects')).toBe(false);
  await expect(back).toBeVisible();
  await expect(forward).toHaveCount(0);
  const more = page.getByRole('button', { name: /^All boards, \d+ out of sight$/ });
  await expect(more).toBeVisible();

  // Each press brings the tab cut at that edge whole into sight, until the first one.
  let before = await scrolled(page);
  for (let i = 0; i < 10 && before > 0; i++) {
    await back.click();
    await expect.poll(() => scrolled(page)).toBeLessThan(before);
    before = await scrolled(page);
  }
  await expect(back).toHaveCount(0);
  expect(await inSight(page, 'My projects')).toBe(true);
  expect(await inSight(page, 'Board 16')).toBe(false);
  await expect(forward).toBeVisible();
  await forward.click();
  await expect.poll(() => scrolled(page)).toBeGreaterThan(0);

  // A mouse wheel scrolls the strip sideways, to its end.
  const strip = (await page.getByRole('navigation', { name: 'Boards' }).boundingBox())!;
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
  await expect.poll(() => inSight(page, 'Board 16')).toBe(true);
  await expect(forward).toHaveCount(0);

  // The list has every board; one chosen from it opens and comes into sight.
  await more.click();
  const list = page.locator('.w-menu:popover-open');
  await expect(list.getByRole('button')).toHaveText(['My projects', ...titlesOf, 'New board']);
  await expect(list.getByRole('button', { name: 'Board 16' })).toBeFocused();
  await list.getByRole('button', { name: 'Board 02' }).click();
  await expect(tab(page, 'Board 02')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => inSight(page, 'Board 02')).toBe(true);
  await expect(page.locator('.w-gallery')).toBeVisible();
  // Nothing past the window: the page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('on a phone the tabs keep one row, and the list of boards makes new ones @mobile', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 600, 'phone layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('tabsphone'), 'en', { layout: 'cards' });
  await expect(page.getByRole('button', { name: 'New board' })).toBeHidden();
  for (const title of ['Garden', 'Travel', 'Books', 'Recipes', 'Health']) await newBoard(page, title);
  expect(await inSight(page, 'Health')).toBe(true);
  const more = page.getByRole('button', { name: /^All boards/ });
  await more.click();
  await page.locator('.w-menu:popover-open').getByRole('button', { name: 'My projects' }).click();
  await expect.poll(() => inSight(page, 'My projects')).toBe(true);
  // One row: the tabs beside the logo and the account, the bottom bar on screen.
  const top = (await page.getByRole('banner').boundingBox())!;
  expect(top.height).toBeLessThan(64);
  await expect(page.locator('.w-foot')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
