import { test, expect } from '../../src/fixtures/test-base';
import { homeUrl } from '../../src/core/app-url';

test.describe('BF-LOGOUT-002 User Logout @BF-LOGOUT-002 @negative @authentication', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-LOGOUT-002-N01 unauthenticated home access redirects to login @negative', async ({ page }) => {
      await page.goto(homeUrl());
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-LOGOUT-002-E01 back navigation after logout requires re-auth @negative', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.signOut();
    await expect(page).toHaveURL(/login/i);
    await page.goBack().catch(() => undefined);
    await expect(page).toHaveURL(/login/i);
  });
});
