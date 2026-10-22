import { expect, type BrowserContext, type Page } from '@playwright/test';

const IDP = `http://127.0.0.1:${process.env.E2E_IDP_PORT ?? 9311}`;

/** A person no earlier run has seen, so every test starts from the welcome board. */
export const freshUser = (name: string) => `${name}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/**
 * Signs `user` in through the test identity provider. A person starts on Cards; most tests
 * work on columns, so this switches to them (the choice is kept on this browser) unless
 * `layout` says otherwise.
 */
export async function signIn(page: Page, user: string, locale = 'en', { layout = 'columns' }: { layout?: 'cards' | 'columns' } = {}) {
  await page.context().addCookies([{ name: 'e2e_user', value: user, url: IDP }]);
  await page.goto(`/${locale}/app`);
  await page.waitForURL(/\/signin/);
  await page.getByRole('button', { name: /Test IdP/ }).click();
  await page.waitForURL(new RegExp(`/${locale}/app`));
  const views = page.locator('.nr-visoes button'); // Cards, Columns, Due, in every language
  await expect(page.locator('.w-gallery')).toBeVisible();
  await expect(views.nth(0)).toHaveAttribute('aria-pressed', 'true');
  if (layout === 'cards') return;
  await views.nth(1).click();
  await expect(page.locator('.w-board')).toBeVisible();
}

/** A new board, opened. On a phone, New board is the last line of the list of every board. */
export async function newBoard(page: Page, title: string) {
  const add = page.getByRole('button', { name: 'New board' });
  if (!(await add.isVisible())) await page.getByRole('button', { name: /^All boards/ }).click();
  await add.click();
  const input = page.getByRole('textbox', { name: 'Board name' });
  await input.fill(title);
  await input.press('Enter');
  await expect(page.locator('.w-board-tab', { hasText: title })).toHaveAttribute('aria-current', 'page');
}

export const lane = (page: Page, title: string) => page.locator('.w-lane', { has: page.getByRole('heading', { name: title, exact: true }) });
export const card = (page: Page, title: string) => page.locator('.w-card', { hasText: title });

/** Waits until nothing is left to send. */
export async function settled(page: Page) {
  await expect(page.locator('.w-status')).toHaveAttribute('data-tone', 'on');
}

export async function capture(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Capture a note' });
  await input.fill(text);
  await input.press('Enter');
}

export async function secondTab(context: BrowserContext, url: string) {
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('.w-board')).toBeVisible();
  return other;
}
