import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { freshUser, lane, settled, signIn } from './helpers';

/** A real PNG, w×h, in two colours: the server decodes and re-encodes what it gets. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) rows.push(x < w / 2 ? 230 : 20, 120, y < h / 2 ? 40 : 200);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('a picture becomes an idea: it fills its shape on the map, shows on its card, and on a shared link', async ({ page, browser }) => {
  await signIn(page, freshUser('pictures'));
  await lane(page, 'Inbox').getByRole('button', { name: 'Map of “Inbox”' }).click();
  const map = page.locator('.w-map');
  await expect(map.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  await map.locator('.w-map__bar input[type="file"]').setInputFiles({ name: 'sales-chart.png', mimeType: 'image/png', buffer: png(300, 200) });
  const pic = map.locator('.w-map__node[data-picture]');
  await expect(pic).toHaveCount(1);
  const img = pic.locator('img.w-map__pic');
  await expect(img).toHaveJSProperty('complete', true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(300);
  // In proportion: 3:2, the picture's own.
  const box = (await pic.boundingBox())!;
  expect(box.width / box.height).toBeGreaterThan(1.4);
  expect(box.width / box.height).toBeLessThan(1.6);

  // Its panel: the picture, its tools, and the shapes it can take.
  const panel = page.locator('.w-map__panel');
  await expect(panel.getByRole('button', { name: 'Change picture' })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue('sales-chart');
  await panel.getByRole('button', { name: 'Ellipse' }).click();
  await expect(pic).toHaveAttribute('data-shape', 'ellipse');
  await expect(img).toHaveCSS('border-radius', '50%');
  await settled(page);

  // On its card in the column, too.
  await page.getByRole('button', { name: 'Back to the board' }).click();
  await expect(lane(page, 'Inbox').locator('.w-card .w-card__pic')).toHaveCount(1);

  // A shared link shows it, through the link.
  await lane(page, 'Inbox').getByRole('button', { name: 'Thought “Inbox”: more actions' }).click();
  await page.getByRole('button', { name: 'Share…' }).click();
  const share = page.locator('.w-share:popover-open');
  await share.getByRole('button', { name: 'Create a link to view' }).click();
  const url = await share.getByRole('textbox', { name: 'Link' }).inputValue();
  const guest = await browser.newContext({ locale: 'en-US' });
  const visitor = await guest.newPage();
  await visitor.goto(url);
  const seen = visitor.locator('.w-map__node[data-picture] img');
  await expect(seen).toHaveAttribute('src', /\/api\/shared\/[A-Za-z0-9_-]{44}\/files\//);
  await expect(seen).toHaveJSProperty('complete', true);
  expect(await seen.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(300);
  await guest.close();
});

test('pictures dropped on a column become ideas there; one goes back to text', async ({ page }) => {
  await signIn(page, freshUser('dropper'));
  const inbox = lane(page, 'Inbox');
  const data = png(120, 240).toString('base64');
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const t = new DataTransfer();
    t.items.add(new File([bytes], 'scan.png', { type: 'image/png' }));
    return t;
  }, data);
  await inbox.locator('.w-cards').dispatchEvent('dragover', { dataTransfer: dt });
  await inbox.locator('.w-cards').dispatchEvent('drop', { dataTransfer: dt });
  const card = inbox.locator('.w-card', { has: page.locator('.w-card__pic') });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('scan');

  await card.click();
  const drawer = page.locator('.w-drawer');
  await expect(drawer.locator('.w-picture__frame img')).toBeVisible();
  await drawer.getByRole('button', { name: 'Remove picture' }).click();
  await expect(inbox.locator('.w-card__pic')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Add a picture' })).toBeVisible();
});
