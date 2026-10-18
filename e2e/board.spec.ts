import { expect, test } from '@playwright/test';
import { capture, card, freshUser, lane, secondTab, settled, signIn } from './helpers';

test('a new account starts on the welcome board @mobile', async ({ page }) => {
  await signIn(page, freshUser('ana'));
  await expect(lane(page, 'Inbox')).toBeVisible();
  await expect(card(page, 'Welcome to noergo')).toBeVisible();
  await expect(page.locator('.w-status')).toHaveAttribute('data-tone', 'on');
});

test('capture, edit and delete a note, and it all survives a reload', async ({ page }) => {
  await signIn(page, freshUser('bia'));
  await capture(page, 'Buy oat milk');
  await expect(lane(page, 'Inbox').locator('.w-card').first()).toContainText('Buy oat milk');

  await card(page, 'Buy oat milk').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('textbox', { name: 'Title' })).toHaveValue('Buy oat milk');
  await drawer.getByRole('textbox', { name: 'Title' }).fill('Buy oat milk (2 L)');
  await drawer.getByRole('button', { name: 'Write' }).click();
  const body = drawer.getByRole('textbox', { name: 'Note' });
  await body.fill('the barista kind\n\nsee [[Quick capture]]');
  await drawer.getByRole('button', { name: 'Read' }).click();
  await expect(drawer.locator('.w-wikilink', { hasText: 'Quick capture' })).toBeVisible();
  // The server turns the [[wikilink]] into a link of the note.
  await expect(drawer.getByRole('region', { name: 'Links' }).getByRole('button', { name: 'Quick capture' })).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Add a tag' }).fill('errand');
  await drawer.getByRole('textbox', { name: 'Add a tag' }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await settled(page);

  await page.reload();
  await expect(card(page, 'Buy oat milk (2 L)')).toContainText('errand');
  await card(page, 'Buy oat milk (2 L)').click();
  await expect(page.getByRole('dialog').getByText('see')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete note' }).click();
  await expect(card(page, 'Buy oat milk (2 L)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(card(page, 'Buy oat milk (2 L)')).toBeVisible();
});

test('the keyboard moves notes between columns', async ({ page }) => {
  await signIn(page, freshUser('caio'));
  const note = card(page, 'Quick capture');
  await note.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(lane(page, 'Doing').locator('.w-card', { hasText: 'Quick capture' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Moved to' })).toContainText('Moved to “Doing”');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(lane(page, 'Doing').locator('.w-card').first()).toContainText('Quick capture');
  await settled(page);
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await expect(lane(page, 'Inbox').locator('.w-card', { hasText: 'Quick capture' })).toBeVisible();
});

test('the mouse drags a note to another column', async ({ page }) => {
  await signIn(page, freshUser('dani'));
  await card(page, 'Connect an agent').dragTo(lane(page, 'Doing').locator('.w-card').first(), { targetPosition: { x: 40, y: 4 } });
  await expect(lane(page, 'Doing').locator('.w-card').first()).toContainText('Connect an agent');
  await settled(page);
  await page.reload();
  await expect(lane(page, 'Doing').locator('.w-card').first()).toContainText('Connect an agent');
});

test('two tabs of the same person converge', async ({ page, context }) => {
  await signIn(page, freshUser('edu'));
  const other = await secondTab(context, page.url());
  await capture(page, 'Seen from the other tab');
  await expect(card(other, 'Seen from the other tab')).toBeVisible();
  await card(other, 'Seen from the other tab').locator('.w-check').click();
  await expect(card(page, 'Seen from the other tab').locator('.w-check--on')).toBeVisible();
});

test('offline edits wait on the device and go out on reconnect', async ({ page, context }) => {
  await signIn(page, freshUser('fabi'));
  await context.setOffline(true);
  await capture(page, 'Written on the plane');
  await expect(card(page, 'Written on the plane')).toBeVisible();
  await expect(page.locator('.w-status')).not.toHaveAttribute('data-tone', 'on');
  await context.setOffline(false);
  await settled(page);
  await page.reload();
  await expect(card(page, 'Written on the plane')).toBeVisible();
});

test('search finds notes by title and body', async ({ page }) => {
  await signIn(page, freshUser('gabi'));
  await page.keyboard.press('Meta+k');
  const box = page.getByRole('combobox', { name: 'Search' });
  await box.fill('mind map');
  await expect(page.getByRole('option').first()).toContainText('Mind map');
  await box.press('Enter');
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Title' })).toHaveValue('Mind map');
});

test('the workspace speaks Chinese', async ({ page }) => {
  await signIn(page, freshUser('hui'), 'zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('textbox', { name: /记/ })).toBeVisible();
});
