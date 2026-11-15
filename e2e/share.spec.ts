import { expect, test, type Page } from '@playwright/test';
import { freshUser, lane, newBoard, settled, signIn } from './helpers';

const sharePanel = (page: Page) => page.locator('.w-share:popover-open');

async function addNote(page: Page, thought: string, text: string) {
  await lane(page, thought).getByRole('button', { name: 'New note' }).click();
  const input = lane(page, thought).getByRole('textbox', { name: 'New note' });
  await input.fill(text);
  await input.press('Enter');
}

/** Shares the board on screen from its menu and returns the link. */
async function shareBoard(page: Page, title: string, access: 'Can view' | 'Can edit') {
  await openBoardShare(page, title);
  return makeLink(page, access);
}

async function openBoardShare(page: Page, title: string) {
  await page.getByRole('button', { name: `Board “${title}”: more actions` }).click();
  await page.getByRole('button', { name: 'Share…' }).click();
}

async function makeLink(page: Page, access: 'Can view' | 'Can edit') {
  const panel = sharePanel(page);
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: access }).click();
  await panel.getByRole('button', { name: access === 'Can view' ? 'Create a link to view' : 'Create a link to edit' }).click();
  const url = await panel.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{44}$/);
  return url;
}

test('a view link shows one board to anyone, live, and nothing else of the workspace', async ({ page, browser }) => {
  await signIn(page, freshUser('sharer'));
  await newBoard(page, 'Holiday');
  await page.getByRole('button', { name: 'New thought' }).click();
  await page.getByRole('textbox', { name: 'Thought name' }).fill('Packing');
  await page.getByRole('textbox', { name: 'Thought name' }).press('Enter');
  await addNote(page, 'Packing', 'Sunscreen');
  await settled(page);
  const url = await shareBoard(page, 'Holiday', 'Can view');

  // The same panel, opened again, gives the same link.
  await page.keyboard.press('Escape');
  await openBoardShare(page, 'Holiday');
  await expect(sharePanel(page).getByRole('textbox', { name: 'Link' })).toHaveValue(url);
  await page.keyboard.press('Escape');

  const guest = await browser.newContext({ locale: 'en-US' });
  const visitor = await guest.newPage();
  await visitor.goto(url);
  await expect(visitor).toHaveURL(/\/en\/s\//);
  await expect(visitor).toHaveTitle(/Holiday/);
  await visitor.getByRole('button', { name: 'Columns' }).click();
  await expect(lane(visitor, 'Packing')).toBeVisible();
  await expect(visitor.locator('.w-card', { hasText: 'Sunscreen' })).toBeVisible();
  // Only this board: the welcome board stays private.
  await expect(visitor.locator('.w-board-tab')).toHaveText(['Holiday']);
  await expect(visitor.locator('.w-shared__badge')).toContainText('View only');
  await expect(visitor.getByRole('textbox', { name: 'Capture a note' })).toHaveCount(0);
  await expect(visitor.getByRole('button', { name: 'New thought' })).toHaveCount(0);
  await expect(lane(visitor, 'Packing').getByRole('button', { name: 'New note' })).toHaveCount(0);

  // The owner writes; the visitor sees it arrive.
  await addNote(page, 'Packing', 'Passport');
  await expect(visitor.locator('.w-card', { hasText: 'Passport' })).toBeVisible();

  // A note opens to read, not to change.
  await visitor.locator('.w-card', { hasText: 'Sunscreen' }).click();
  await expect(visitor.getByRole('textbox', { name: 'Title' })).toHaveAttribute('readonly', '');
  await expect(visitor.getByRole('button', { name: 'Delete note' })).toHaveCount(0);

  // Turned off, the link opens nothing.
  await openBoardShare(page, 'Holiday');
  await sharePanel(page).getByRole('button', { name: 'Turn this link off' }).click();
  await expect(sharePanel(page)).toContainText('Link turned off');
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'This link is not available' })).toBeVisible();
  await guest.close();
});

test('an edit link lets a signed-in person change the thought, and asks the others to sign in', async ({ page, browser }) => {
  await signIn(page, freshUser('owner'));
  const inbox = lane(page, 'Inbox');
  await inbox.getByRole('button', { name: 'Thought “Inbox”: more actions' }).click();
  await page.getByRole('button', { name: 'Share…' }).click();
  const url = await makeLink(page, 'Can edit');
  await page.keyboard.press('Escape');

  // Without an account: it shows, and offers to sign in.
  const guest = await browser.newContext({ locale: 'en-US' });
  const anonymous = await guest.newPage();
  await anonymous.goto(url);
  await expect(anonymous.locator('.w-map')).toBeVisible();
  await expect(anonymous.getByRole('link', { name: 'Sign in to edit' })).toBeVisible();
  await guest.close();

  // Signed in as someone else: it opens on the thought's map, and writes go through.
  const other = await browser.newContext({ locale: 'en-US' });
  const editor = await other.newPage();
  await signIn(editor, freshUser('editor'));
  await editor.goto(url);
  await expect(editor.locator('.w-map')).toBeVisible();
  await expect(editor.locator('.w-shared__badge')).toContainText('Can edit');
  await expect(editor.locator('.w-map__title')).toHaveText('Inbox');
  await editor.getByRole('button', { name: 'Back to the board' }).click();
  await expect(editor.locator('.w-board-tab')).toHaveText(['Inbox']);
  await editor.getByRole('textbox', { name: 'Capture a note' }).fill('Written by a guest');
  await editor.getByRole('textbox', { name: 'Capture a note' }).press('Enter');
  await settled(editor);
  // Only this thought: the owner's other thoughts are not on the guest's screen.
  await expect(editor.locator('.w-lane')).toHaveCount(1);

  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(lane(page, 'Inbox').locator('.w-card', { hasText: 'Written by a guest' })).toBeVisible();
  await other.close();
});

test('on a view link the visitor folds and opens for themselves: the red counts, fold all, levels', async ({ page, browser }) => {
  await signIn(page, freshUser('folder'));
  const welcome = page.locator('.w-card', { hasText: 'Welcome to noergo' });
  await welcome.click();
  const drawer = page.locator('.w-drawer');
  await drawer.getByRole('textbox', { name: 'New idea below' }).fill('Packing list');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: /^Fold the ideas below/ }).click();
  await expect(welcome.getByRole('button', { name: '1 idea folded inside. Show' })).toBeVisible();
  await settled(page);
  await lane(page, 'Inbox').getByRole('button', { name: 'Thought “Inbox”: more actions' }).click();
  await page.getByRole('button', { name: 'Share…' }).click();
  const url = await makeLink(page, 'Can view');
  await page.keyboard.press('Escape');

  const guest = await browser.newContext({ locale: 'en-US' });
  const visitor = await guest.newPage();
  await visitor.goto(url);
  const node = (text: string) => visitor.locator('.w-map__node', { hasText: text });
  await expect(node('Welcome to noergo')).toBeVisible();
  await expect(node('Packing list')).toHaveCount(0);

  // The red count opens the branch, on this screen.
  await node('Welcome to noergo').getByRole('button', { name: '1 idea folded inside. Show' }).click();
  await expect(node('Packing list')).toBeVisible();
  // Fold all and the levels are there too.
  const bar = visitor.locator('.w-map__bar');
  await bar.getByRole('button', { name: 'Fold all' }).click();
  await expect(node('Packing list')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Show all' }).click();
  await expect(node('Packing list')).toBeVisible();
  await bar.getByRole('button', { name: 'Levels on show' }).click();
  await visitor.getByRole('button', { name: 'Show 1 level' }).click();
  await expect(node('Packing list')).toHaveCount(0);
  // Nothing was sent: no "only lets you look" notice, and the owner's branch is still folded.
  await expect(visitor.locator('.w-notice')).toHaveCount(0);
  await page.reload();
  await expect(lane(page, 'Inbox').locator('.w-card', { hasText: 'Welcome to noergo' }).getByRole('button', { name: '1 idea folded inside. Show' })).toBeVisible();
  await guest.close();
});
