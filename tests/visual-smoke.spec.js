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

async function openMainTab(page, tab) {
  await page.locator(`.tab[data-tab="${tab}"]`).click();
  await expect(page.locator(`#tab-${tab}`)).toBeVisible();
}

async function expectAppNotBlank(page) {
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.tab.active')).toBeVisible();
  await expect(page.locator('.page.active')).toBeVisible();
}

async function expectAutocompleteResult(page, inputSelector, dropdownSelector, query, expected) {
  await page.locator(inputSelector).fill(query);
  await expect(page.locator(`${dropdownSelector}.open`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`${dropdownSelector}.open .ac-item, ${dropdownSelector}.open .ac-item-muted`).first()).toBeVisible();
  await expect(page.locator(dropdownSelector)).toContainText(expected);
}

async function expectAutocompleteClears(page, inputSelector, dropdownSelector) {
  await page.locator(inputSelector).fill('');
  await expect(page.locator(`${dropdownSelector}.open`)).toHaveCount(0);
}

test.describe('visual smoke', () => {
  test('find trainer autocomplete suggests public directory names', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'find');
    await page.locator('#find-trainer-input').fill('Tes');
    await expect(page.locator('#find-trainer-suggestions.open')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.trainer-suggestion').first()).toContainText(/TestUser/i);
  });

  test('my list renders embedded search strings', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#my-strings-out')).toBeVisible();
    await expect(page.locator('#my-strings-out .str-level').first()).toBeVisible({ timeout: 20_000 });
  });

  test('my list add pokemon autocomplete shows normalized and dex results', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#ac-input')).toBeVisible();

    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', 'pika', /Pikachu/i);
    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', 'Unown ?', /Unown\s*\(\?\)|Unown.*Question/i);
    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', '25', /Pikachu/i);
    await expect(page.locator('#ac-dropdown')).toContainText('#25');

    await expectAutocompleteClears(page, '#ac-input', '#ac-dropdown');
    await expect(page.locator('#add-pmon-sel')).toHaveValue('');
  });

  test('legacy inventory is read-only and export remains available', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'have');
    await expect(page.locator('#have-mine-view')).toBeVisible();
    await expect(page.locator('#have-mine-out')).toBeVisible();
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
    await expect(page.locator('.have-toggle-row')).toBeHidden();
  });

  test('legacy inventory editing controls stay retired', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'have');
    await expect(page.locator('#have-ac-input')).toBeHidden();
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
  });

  test('events renders responsive grouped cards', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'schedule');
    await expect(page.locator('.event-filter-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.event-card, #events-out .empty').first()).toBeVisible({ timeout: 20_000 });
    await expectAppNotBlank(page);
  });

  test('main tab switching keeps the app rendered', async ({ page }) => {
    await signIn(page);
    for (const tab of ['mylist', 'find', 'have', 'schedule', 'settings']) {
      await openMainTab(page, tab);
      await expectAppNotBlank(page);
    }
  });

  test('find trainer touch targets remain usable on mobile', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'find');
    await page.locator('#find-trainer-input').fill('Tes');
    await expect(page.locator('.trainer-suggestion').first()).toBeVisible();
    const box=await page.locator('.trainer-suggestion').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40);
  });

  test('retired top-level surfaces are absent', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('.tab[data-tab="browse"], .tab[data-tab="strings"]')).toHaveCount(0);
    await expect(page.locator('.tabs')).not.toContainText(/Offers|Schedule/);
  });
});
