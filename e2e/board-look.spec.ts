import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, settled, signIn } from './helpers';

const tab = (page: Page, title: string) => page.locator('.w-board-tab', { hasText: title });
const titles = (page: Page) => page.locator('.w-board-tab__title');
const glyph = (page: Page, title: string) => tab(page, title).locator('.w-board-glyph');

async function newBoard(page: Page, title: string) {
  await page.getByRole('button', { name: 'New board' }).click();
  const input = page.getByRole('textbox', { name: 'Board name' });
  await input.fill(title);
  await input.press('Enter');
  await expect(tab(page, title)).toHaveAttribute('aria-current', 'page');
}

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
