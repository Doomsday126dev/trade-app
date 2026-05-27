const { test, expect } = require('@playwright/test');

function isLocalAuthBaseURL() {
  const raw = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4174';
  try {
    const url = new URL(raw);
    return url.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function signIn(page) {
  const user = process.env.POGO_TEST_USER;
  const pin = process.env.POGO_TEST_PIN;
  test.skip(
    isLocalAuthBaseURL(),
    'Authenticated Firebase smoke tests run against deployed GitHub Pages. Use PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/.'
  );
  test.skip(!user || !pin, 'Set POGO_TEST_USER and POGO_TEST_PIN to run authenticated visual smoke tests.');

  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('pogoTourSeen', JSON.stringify(now));
    localStorage.setItem('pogoWhatsNewSeen', JSON.stringify(now));
  });
  await page.goto(`./?pw=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-user, #app', { state: 'visible', timeout: 25_000 });
  if (await page.locator('#app').isVisible().catch(() => false)) return;

  await page.waitForFunction(
    username => {
      const options = Array.from(document.querySelectorAll('#login-user-list option'));
      return options.some(option => option.value === username);
    },
    user,
    { timeout: 25_000 }
  );
  await page.locator('#login-user').fill(user);
  await page.locator('#login-pin').fill(pin);
  await page.locator('#login-btn').click();
  try {
    await expect(page.locator('#app')).toBeVisible({ timeout: 25_000 });
  } catch (err) {
    const loginError = await page.locator('#login-err').innerText().catch(() => '');
    throw new Error(`Login did not reach the app. login-err="${loginError.trim()}"`);
  }
}

async function openInventoryBrowse(page) {
  await page.getByText('Inventory', { exact: false }).first().click();
  await expect(page.locator('#have-mine-view')).toBeVisible();
  await page.locator('.have-toggle-btn[data-view="browse"]').click();
  await expect(page.locator('#have-browse-out')).toBeVisible();
}

test.describe('visual smoke', () => {
  test('inventory community sprites stay in their slots', async ({ page }) => {
    await signIn(page);
    await openInventoryBrowse(page);

    const firstTrainer = page.locator('.have-trainer-card').first();
    await expect(firstTrainer).toBeVisible({ timeout: 20_000 });
    await firstTrainer.locator('.have-trainer-hdr').click();
    await expect(firstTrainer.locator('.have-pmon-card').first()).toBeVisible({ timeout: 10_000 });

    const violations = await firstTrainer.locator('.have-pmon-card').evaluateAll(cards =>
      cards.slice(0, 40).flatMap(card => {
        const slot = card.querySelector('.have-row-sprite');
        const img = slot?.querySelector('img');
        if (!slot || !img) return [];
        const sr = slot.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const slotOk = ir.left >= sr.left - 4 && ir.right <= sr.right + 4 && ir.top >= sr.top - 4 && ir.bottom <= sr.bottom + 4;
        const cardOk = ir.left >= cr.left - 2 && ir.right <= cr.right + 2 && ir.top >= cr.top - 2 && ir.bottom <= cr.bottom + 2;
        const visibleEnough = ir.width >= 14 && ir.height >= 14;
        return slotOk && cardOk && visibleEnough
          ? []
          : [{ name: card.innerText.split('\n')[0], slotOk, cardOk, visibleEnough, img: { w: ir.width, h: ir.height }, slot: { w: sr.width, h: sr.height } }];
      })
    );

    expect(violations).toEqual([]);
  });

  test('browse rows use readable fixed sprite slots', async ({ page }) => {
    await signIn(page);
    await page.getByText('Browse', { exact: false }).first().click();
    await expect(page.locator('.pgrid .pc').first()).toBeVisible({ timeout: 20_000 });

    const violations = await page.locator('.pgrid .pc').evaluateAll(rows =>
      rows.slice(0, 50).flatMap(row => {
        const slot = row.querySelector('.pc-sprite-wrap');
        const img = slot?.querySelector('img');
        const name = row.querySelector('.pc-name')?.textContent?.trim() || row.innerText.split('\n')[0];
        if (!slot || !img) return [{ name, reason: 'missing sprite wrapper' }];
        const sr = slot.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const slotReadable = sr.width >= 38 && sr.height >= 38;
        const imgReadable = Math.max(ir.width, ir.height) >= 32;
        const rowContained = ir.top >= rowRect.top - 12 && ir.bottom <= rowRect.bottom + 12;
        return slotReadable && imgReadable && rowContained
          ? []
          : [{ name, slotReadable, imgReadable, rowContained, img: { w: ir.width, h: ir.height }, slot: { w: sr.width, h: sr.height } }];
      })
    );
    expect(violations).toEqual([]);
  });
});
