import { expect, type BrowserContext, type Page } from '@playwright/test';

const IDP = `http://127.0.0.1:${process.env.E2E_IDP_PORT ?? 9311}`;

/** A person no earlier run has seen, so every test starts from the welcome board. */
export const freshUser = (name: string) => `${name}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Signs `user` in through the test identity provider and waits for the board. */
export async function signIn(page: Page, user: string, locale = 'en') {
  await page.context().addCookies([{ name: 'e2e_user', value: user, url: IDP }]);
  await page.goto(`/${locale}/app`);
  await page.waitForURL(/\/signin/);
  await page.getByRole('button', { name: /Test IdP/ }).click();
  await page.waitForURL(new RegExp(`/${locale}/app`));
  await expect(page.locator('.w-board')).toBeVisible();
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
