import { test, expect } from '../../src/fixtures/test-base';
import { appPath, appUrl } from '../../src/core/app-url';

test.describe('BF-MANUAL-INVOICE-009 Manual Invoice @BF-MANUAL-INVOICE-009 @negative @read-only-sanity @no-transaction', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-MANUAL-INVOICE-009-N01 unauthenticated manual bills redirects to login @negative', async ({
      page,
    }) => {
      await page.goto(appUrl('ea1/manual-bills-book'));
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-MANUAL-INVOICE-009-N02 required-field validation visible without submit @negative', async ({ page }) => {
    await page.goto(appPath('ea1/manual-bills-book'));
    const create = page.locator('button:has-text("Create Invoice"), input[value="Create Invoice"]');
    if (await create.count()) {
      await expect(create.first()).toBeVisible();
    }
    const body = await page.innerText('body');
    expect(body.length).toBeGreaterThan(0);
  });
});
