import { expect, test } from '@playwright/test';
import { freshUser, signIn } from './helpers';

test('the account menu switches the language, and the choice is remembered', async ({ page }) => {
  await signIn(page, freshUser('lang'));
  await page.getByRole('button', { name: 'Account' }).click();
  const languages = page.getByRole('group', { name: 'Language' });
  await expect(languages.getByRole('link')).toHaveText(['Português', 'English', '中文']);
  await expect(languages.getByRole('link', { name: 'English' })).toHaveAttribute('aria-current', 'true');

  await languages.getByRole('link', { name: 'Português' }).click();
  await page.waitForURL((u) => u.pathname === '/pt/app');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.getByRole('button', { name: 'Novo quadro' })).toBeVisible();

  // The address without a language now leads to Portuguese.
  await page.goto('/');
  await page.waitForURL((u) => u.pathname === '/pt');
});

test('the sign-in page offers the three languages and keeps the way into the app', async ({ page }) => {
  await page.goto('/en/signin');
  const languages = page.getByRole('navigation', { name: 'Language' });
  await expect(languages.getByRole('link')).toHaveText(['Português', 'English', '中文']);
  await expect(languages.getByRole('link', { name: 'English' })).toHaveAttribute('aria-current', 'page');

  await languages.getByRole('link', { name: '中文' }).click();
  await page.waitForURL((u) => u.pathname === '/zh/signin');
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/zh/app');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('signing out lands on the home page of the person’s language', async ({ page }) => {
  await signIn(page, freshUser('bye'), 'zh');
  await page.getByRole('button', { name: '账户' }).click();
  await page.getByRole('button', { name: '退出' }).click();
  // The deployment serves its landing page there (noergo.com does).
  await page.waitForURL((u) => u.pathname === '/zh');

  await page.goto('/zh/app');
  await page.waitForURL(/\/zh\/signin/);
});
