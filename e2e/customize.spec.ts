import { expect, test, type Locator, type Page } from '@playwright/test';
import { freshUser, lane, settled, signIn } from './helpers';

/** A 600 × 200 PNG: a purple mark on white, like a screenshot of a logo. */
async function logo(page: Page, color = '#7c3aed'): Promise<Buffer> {
  const url = await page.evaluate((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 200);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(160, 100, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(260, 70, 280, 60);
    return canvas.toDataURL('image/png');
  }, color);
  return Buffer.from(url.split(',')[1]!, 'base64');
}

/** Lets a picture go over `target`, the way a file dragged from the desktop arrives. */
async function dropPicture(target: Locator, png: Buffer, type = 'image/png') {
  await target.evaluate(
    (el, { b64, type }) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'logo.png', { type }));
      for (const kind of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { b64: png.toString('base64'), type },
  );
}

/** How far a computed colour is from `hex`: colours read from a picture are averages. */
const off = (l: Locator, prop: string, hex: string) =>
  l.evaluate(
    (el, { prop, hex }) => {
      const got = (getComputedStyle(el).getPropertyValue(prop).match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(...want.map((v, i) => Math.abs(v - (got[i] ?? -999))));
    },
    { prop, hex },
  );

const panel = (page: Page) => page.locator('.w-customize');
const tile = (page: Page, title: string) => page.locator('.w-tile', { hasText: title });
const tiles = (page: Page) => page.locator('.w-tile__title');

test('columns as cards: drag to reorder, a click opens the column at the start of the board', async ({ page }) => {
  await signIn(page, freshUser('cards'));
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(tiles(page)).toHaveText(['Inbox', 'Doing', 'Ideas']);
  await expect(tile(page, 'Inbox').locator('.w-tile__blank')).toHaveText('I');

  // Drag "Ideas" before "Inbox".
  const from = (await tile(page, 'Ideas').boundingBox())!;
  const to = (await tile(page, 'Inbox').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 12, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(tiles(page)).toHaveText(['Ideas', 'Inbox', 'Doing']);

  // Alt + arrow moves the focused card.
  await tile(page, 'Doing').getByRole('button', { name: /^Doing/ }).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(tiles(page)).toHaveText(['Ideas', 'Doing', 'Inbox']);
  await settled(page);

  // The layout is remembered; the order is saved.
  await page.reload();
  await expect(tiles(page)).toHaveText(['Ideas', 'Doing', 'Inbox']);

  await tile(page, 'Inbox').getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.locator('.w-board')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Columns' })).toHaveAttribute('aria-pressed', 'true');
  await expect(lane(page, 'Inbox')).toBeFocused();
  await expect(lane(page, 'Inbox')).toBeInViewport();
  // A click shows the column; it does not undo the order chosen by dragging.
  await expect(page.locator('.w-lane__title')).toHaveText(['Ideas', 'Doing', 'Inbox']);
});

test('a cover and a colour: chosen, framed, recoloured, and they survive a reload', async ({ page }) => {
  await signIn(page, freshUser('cover'));
  const inbox = lane(page, 'Inbox');
  await inbox.getByRole('button', { name: 'Customise “Inbox”' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('Drop an image here')).toBeVisible();

  await panel(page).locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await logo(page) });
  // The picture shows at once, then lands on the server; the column takes its colour.
  await expect(inbox.locator('.w-lane__cover img')).toHaveAttribute('src', /\/api\/files\/[0-9a-f-]{36}$/);
  await expect(inbox).toHaveAttribute('data-tinted', 'true');
  await expect.poll(() => off(inbox, 'background-color', '#7c3aed')).toBeLessThan(6);
  await expect(inbox.locator('.w-lane__title')).toHaveCSS('color', 'rgb(255, 255, 255)');
  // Its notes take a light tint of it.
  const noteBg = await inbox.locator('.w-card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(noteBg).not.toBe('rgb(255, 255, 255)');
  // The logo was shot on white: the frame around it is white too.
  await expect(panel(page).getByRole('radio', { name: 'Like the image edge' })).toHaveCount(0);
  await expect(panel(page).getByRole('radio', { name: 'White' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel(page).getByRole('radio', { name: /^Image colour/ }).first()).toHaveAttribute('aria-checked', 'true');

  // Bigger, then dragged to the left.
  const img = inbox.locator('.w-lane__cover img');
  const before = await img.evaluate((el) => parseFloat(el.style.width));
  await panel(page).getByRole('button', { name: 'Larger' }).click();
  await panel(page).getByRole('button', { name: 'Larger' }).click();
  await expect.poll(() => img.evaluate((el) => parseFloat(el.style.width))).toBeCloseTo(before * 1.5625, 1);
  const editor = panel(page).getByRole('group', { name: 'Cover position' });
  const box = (await editor.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const left = await img.evaluate((el) => parseFloat(el.style.left));

  // A palette colour, then any colour.
  await panel(page).getByRole('radio', { name: 'Indigo' }).click();
  await expect(inbox).toHaveAttribute('data-cor', 'anil');
  await panel(page).getByLabel('Any colour…').fill('#0e7490');
  await panel(page).getByLabel('Any colour…').dispatchEvent('change');
  await expect(inbox).toHaveCSS('background-color', 'rgb(14, 116, 144)');
  await panel(page).getByRole('button', { name: 'Done' }).click();
  await expect(panel(page)).toBeHidden();
  await settled(page);

  await page.reload();
  await expect(inbox.locator('.w-lane__cover img')).toHaveAttribute('src', /\/api\/files\//);
  await expect.poll(() => img.evaluate((el) => parseFloat(el.style.left))).toBeCloseTo(left, 1);
  await expect(inbox).toHaveCSS('background-color', 'rgb(14, 116, 144)');

  // The map wears the cover top left, the colour on its bar and, lightly, on its canvas.
  await inbox.getByRole('button', { name: 'Map of “Inbox”' }).click();
  const map = page.locator('.w-map');
  await expect(map.locator('.w-map__cover img')).toHaveAttribute('src', /\/api\/files\//);
  await expect(map.locator('.w-map__bar')).toHaveCSS('color', 'rgb(255, 255, 255)');
  const canvas = await map.locator('.w-map__canvas').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(canvas).not.toBe('rgb(255, 255, 255)');
  await map.getByRole('button', { name: 'Customise “Inbox”' }).first().click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Remove' }).click();
  await expect(map.locator('.w-map__cover')).toHaveCount(0);
});

test('a picture dropped on a column becomes its cover; anything else is refused', async ({ page }) => {
  await signIn(page, freshUser('drop'));
  const doing = lane(page, 'Doing');
  await dropPicture(doing.locator('.w-lane__top'), await logo(page, '#0e9f6e'));
  await expect(panel(page)).toBeVisible();
  await expect(doing.locator('.w-lane__cover img')).toHaveAttribute('src', /\/api\/files\//);
  await expect.poll(() => off(doing, 'background-color', '#0e9f6e')).toBeLessThan(6);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  // A card takes a drop too.
  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(tile(page, 'Doing').locator('.w-cover img')).toBeVisible();
  await dropPicture(tile(page, 'Ideas'), Buffer.from('not a picture'), 'text/plain');
  await expect(page.getByText('That is not an image. Use a PNG, JPEG, WebP or GIF.')).toBeVisible();

  // The server checks the bytes, not the name: a text file called .png is refused.
  const res = await page.request.post('/api/files', { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), headers: { 'Content-Type': 'image/png', Origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(422);
});

test('a heavy screenshot travels shrunk, and a proxy’s refusal reads as too large', async ({ page }) => {
  await signIn(page, freshUser('heavy'));
  // 1500 × 1000 of noise: within the side the app sends as is, but megabytes as a PNG.
  const heavy = Buffer.from(
    (
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1500;
        canvas.height = 1000;
        const ctx = canvas.getContext('2d')!;
        const img = ctx.createImageData(1500, 1000);
        for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : (Math.random() * 256) | 0;
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL('image/png');
      })
    ).split(',')[1]!,
    'base64',
  );
  expect(heavy.byteLength).toBeGreaterThan(3 * 1024 * 1024);
  const sent: number[] = [];
  await page.route('**/api/files', async (route) => {
    sent.push(route.request().postDataBuffer()?.byteLength ?? 0);
    await route.continue();
  });
  const doing = lane(page, 'Doing');
  await dropPicture(doing.locator('.w-lane__top'), heavy);
  await expect(doing.locator('.w-lane__cover img')).toHaveAttribute('src', /\/api\/files\/[0-9a-f-]{36}$/);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toBeLessThanOrEqual(2 * 1024 * 1024);
  await page.keyboard.press('Escape');

  // A reverse proxy in front refuses a big body with 413 and a page of its own.
  await page.unroute('**/api/files');
  await page.route('**/api/files', (route) => route.fulfill({ status: 413, contentType: 'text/html', body: '<html><body>413 Request Entity Too Large</body></html>' }));
  await dropPicture(lane(page, 'Ideas').locator('.w-lane__top'), await logo(page));
  await expect(page.getByText('This image is too large.').first()).toBeVisible();
});

test('the brush renames a thought and gives it a website that opens in a new tab', async ({ page, context }) => {
  await context.route('https://example.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Example</title>' }));
  await signIn(page, freshUser('site'), 'en', { layout: 'cards' });
  await tile(page, 'Inbox').hover();
  await tile(page, 'Inbox').getByRole('button', { name: 'Customise “Inbox”' }).click();

  // The name is a field: typed over and kept on Enter.
  const name = panel(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Inbox');
  await name.fill('Clients');
  await name.press('Enter');
  await expect(tiles(page).first()).toHaveText('Clients');
  await expect(page.getByRole('dialog', { name: 'Customise thought Clients' })).toBeVisible();

  // Typed the way people say it; something a click could run is refused and not saved.
  const site = panel(page).getByRole('textbox', { name: 'Website' });
  await site.fill('javascript:alert(1)');
  await site.press('Enter');
  await expect(site).toHaveAttribute('aria-invalid', 'true');
  await expect(panel(page).getByText('That doesn’t look like a web address, such as example.com.')).toBeVisible();
  await expect(tile(page, 'Clients').getByRole('link')).toHaveCount(0);
  await site.fill('example.com');
  await site.press('Enter');
  await expect(site).toHaveValue('https://example.com/');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  // One click on the card opens it in a new tab.
  const open = tile(page, 'Clients').getByRole('link', { name: 'Open the website of “Clients”, example.com, in a new tab' });
  await expect(open).toHaveAttribute('href', 'https://example.com/');
  await expect(open).toHaveAttribute('rel', /noopener/);
  const [tab] = await Promise.all([page.waitForEvent('popup'), open.click()]);
  await expect(tab).toHaveURL('https://example.com/');
  await tab.close();

  // One undo takes the website away, and redo brings it back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(open).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(open).toBeVisible();

  // It is kept, and it is there in the column and on the map too.
  await settled(page);
  await page.reload();
  await expect(open).toHaveAttribute('href', 'https://example.com/');
  await page.getByRole('button', { name: 'Columns' }).click();
  const column = lane(page, 'Clients');
  await expect(column.getByRole('link', { name: 'Open the website of “Clients”, example.com, in a new tab' })).toHaveAttribute('target', '_blank');
  await column.getByRole('button', { name: 'Map of “Clients”' }).click();
  await expect(page.locator('.w-map__bar').getByRole('link', { name: 'Open the website of “Clients”, example.com, in a new tab' })).toBeVisible();
});

test('cards and the customise sheet on a phone @mobile', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 600, 'phone layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, freshUser('phone'));
  await page.getByRole('button', { name: 'Cards' }).click();
  const a = (await tile(page, 'Inbox').boundingBox())!;
  const b = (await tile(page, 'Doing').boundingBox())!;
  // Two cards side by side.
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  // A small card keeps its map and its menu; customising is in the menu.
  await expect(tile(page, 'Inbox').getByRole('button', { name: 'Customise “Inbox”' })).toBeHidden();
  await tile(page, 'Inbox').getByRole('button', { name: 'Thought “Inbox”: more actions' }).click();
  await page.locator('.w-menu:popover-open').getByRole('button', { name: /^Name, website, cover/ }).click();
  const sheet = (await panel(page).boundingBox())!;
  expect(sheet.width).toBe(390);
  expect(Math.round(sheet.y + sheet.height)).toBe(844);
});
