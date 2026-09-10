import { test, expect } from '../../src/fixtures/test-base';

test.describe('BF-HOME-010-01 Item Search @BF-HOME-010-01 @negative @product-search', () => {
  test('TC-BF-HOME-010-01-N01 invalid item code shows sold out or not in stock @negative', async ({
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

  test('TC-BF-HOME-010-01-E01 scan control is present without error @negative', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.openItemSearch();
    await expect(page.locator('#B24029796092184015, button[aria-label="Scan"]')).toBeVisible();
  });
});
