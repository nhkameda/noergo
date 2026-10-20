import { expect, test, type Page } from '@playwright/test';
import { freshUser, signIn } from './helpers';

const IDP = `http://127.0.0.1:${process.env.E2E_IDP_PORT ?? 9311}`;

/** admin@noergo.test is on NOERGO_ADMIN_EMAILS (playwright.config.ts). */
async function openAdmin(page: Page) {
  await signIn(page, 'admin', 'en', { layout: 'cards' });
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.waitForURL((u) => u.pathname === '/en/admin');
}

async function openAccount(page: Page, email: string) {
  await page.getByLabel('E-mail or name').fill(email);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: email }).click();
  await expect(page.getByRole('heading', { name: email })).toBeVisible();
}

/** Tries to sign in, and returns the refusal the sign-in page shows. */
async function refusal(page: Page, user: string) {
  await page.context().addCookies([{ name: 'e2e_user', value: user, url: IDP }]);
  await page.goto('/en/signin');
  await page.getByRole('button', { name: /Test IdP/ }).click();
  await page.waitForURL(/\/en\/signin\?error=/);
  // Within main: Next's route announcer is an alert too, outside it.
  return page.getByRole('main').getByRole('alert');
}

test('an administrator blocks an account out of its session and sign-in, and lets it back', async ({ page, browser }) => {
  const user = freshUser('blocked');
  const theirs = await (await browser.newContext()).newPage();
  await signIn(theirs, user, 'en', { layout: 'cards' });

  await openAdmin(page);
  await openAccount(page, `${user}@noergo.test`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Block account' }).click();
  await expect(page.getByText(/^Blocked since/)).toBeVisible();

  // Out at the next request, and refused at the door.
  await theirs.reload();
  await theirs.waitForURL(/\/en\/signin/);
  await expect(await refusal(theirs, user)).toHaveText('This account is blocked. Talk to the administrator of this noergo.');

  await page.getByRole('button', { name: 'Unblock account' }).click();
  await expect(page.getByText('The account can sign in.')).toBeVisible();
  await signIn(theirs, user, 'en', { layout: 'cards' });
  await theirs.context().close();
});

test('sign-up follows what the administrator saves, and goes back to the environment', async ({ page, browser }) => {
  await openAdmin(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.waitForURL((u) => u.pathname === '/en/admin/settings');
  const save = async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
  };
  const newcomer = freshUser('newcomer');
  const theirs = await (await browser.newContext()).newPage();

  try {
    await page.getByLabel('Who may create an account').selectOption('allowlist');
    await page.getByLabel('Inherit the list').uncheck();
    await page.getByLabel('E-mails and domains allowed to sign up').fill('@example.org');
    await save();
    await expect(await refusal(theirs, newcomer)).toHaveText(/^Sign-up on this server is by invitation/);

    await page.getByLabel('E-mails and domains allowed to sign up').fill(`@example.org\n${newcomer}@noergo.test`);
    await save();
    await signIn(theirs, newcomer, 'en', { layout: 'cards' });
  } finally {
    // The other tests sign up under the environment's list (@noergo.test).
    await page.getByLabel('Who may create an account').selectOption('inherit');
    await page.getByLabel('Inherit the list').check();
    await save();
    await theirs.context().close();
  }
  await expect(page.getByLabel('E-mails and domains allowed to sign up')).toBeDisabled();
});

test('@mobile an account that is not an administrator finds no administration', async ({ page }) => {
  await signIn(page, freshUser('plain'), 'en', { layout: 'cards' });
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('link', { name: 'Agents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  for (const path of ['/en/admin', '/en/admin/settings']) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});

test('@mobile the administration fits a phone', async ({ page }) => {
  await openAdmin(page);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await openAccount(page, 'admin@noergo.test');
  await expect(page.getByText('This is your account.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Block account' })).toHaveCount(0);
  expect(await fits()).toBe(true);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('Who may connect agents')).toBeVisible();
  expect(await fits()).toBe(true);
});
