import { test, expect } from '../../src/fixtures/test-base';
import { appUrl } from '../../src/core/app-url';

test.describe('BF-REPORTS-007 Reports @BF-REPORTS-007 @negative @read-only-sanity @no-transaction', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('TC-BF-REPORTS-007-N01 unauthenticated reports master redirects to login @negative', async ({ page }) => {
    await page.goto(appUrl('ea1/51'));
    await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
  });

  test('TC-BF-REPORTS-007-N02 unauthenticated manual bill report redirects to login @negative', async ({ page }) => {
    await page.goto(appUrl('ea1/manual-bill-report'));
    await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
  });
});
