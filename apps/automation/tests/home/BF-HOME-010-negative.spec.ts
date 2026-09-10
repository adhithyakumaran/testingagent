import { test, expect } from '../../src/fixtures/test-base';
import { homeUrl } from '../../src/core/app-url';

test.describe('BF-HOME-010 Home Navigation Map @BF-HOME-010 @negative @navigation', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-HOME-010-N01 unauthenticated home access redirects to login @negative', async ({ page }) => {
      await page.goto(homeUrl());
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-HOME-010-E01 item search card navigates away from home @negative', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.openItemSearch();
    await expect(page).not.toHaveURL(/\/home$/i);
  });
});
