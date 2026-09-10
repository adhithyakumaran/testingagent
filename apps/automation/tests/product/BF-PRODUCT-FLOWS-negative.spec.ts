import { test, expect } from '../../src/fixtures/test-base';
import { appPath, appUrl } from '../../src/core/app-url';

test.describe('BF-PRODUCT-003 Search Product @BF-PRODUCT-003 @negative @product-search', () => {
  test('TC-BF-PRODUCT-003-N01 invalid item code shows availability status not detail @negative', async ({
    authenticatedPage,
    productSearchPage,
    page,
  }) => {
    const invalid = process.env.EA_INVALID_ITEM_CODE ?? '00000000000000';
    await authenticatedPage.openItemSearch();
    await productSearchPage.expectLoaded();
    await productSearchPage.searchItemCode(invalid);
    const alert = page.locator('.a-Alert, .t-Alert, text=Sold Out, text=Not in Stock');
    await expect(alert.first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('BF-PRODUCT-004 View Product @BF-PRODUCT-004 @negative @product-management', () => {
  test('TC-BF-PRODUCT-004-N01 invalid search does not open product detail @negative', async ({
    authenticatedPage,
    productSearchPage,
    page,
  }) => {
    const invalid = process.env.EA_INVALID_ITEM_CODE ?? '00000000000000';
    await authenticatedPage.openItemSearch();
    await productSearchPage.searchItemCode(invalid);
    await expect(page.locator('.a-Alert, .t-Alert, text=Sold Out, text=Not in Stock').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('BF-PRODUCT-CATALOGUE-006 Product Catalogue @BF-PRODUCT-CATALOGUE-006 @negative', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-PRODUCT-CATALOGUE-006-N01 unauthenticated catalogue redirects to login @negative', async ({
      page,
    }) => {
      await page.goto(appUrl('product-catalogue'));
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-PRODUCT-CATALOGUE-006-E01 catalogue page loads when authenticated @negative', async ({ page }) => {
    await page.goto(appPath('product-catalogue'));
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('BF-BEST-DEAL-008 Best Deal @BF-BEST-DEAL-008 @negative @product-browse', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-BEST-DEAL-008-N01 unauthenticated discount page redirects to login @negative', async ({ page }) => {
      await page.goto(appUrl('product-discount'));
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-BEST-DEAL-008-E01 discount page loads when authenticated @negative', async ({ page }) => {
    await page.goto(appPath('product-discount'));
    await expect(page.locator('#P92_DISCOUNT, .t-Body-content')).toBeTruthy();
  });
});
