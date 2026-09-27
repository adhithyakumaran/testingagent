import { test, expect } from '../../src/fixtures/test-base';
import { attachEvidence } from '../../src/core/evidence';

test.describe('BF-HOME-010-01 Item Search @BF-HOME-010-01 @BF-PRODUCT-003 @regression @product-search', () => {
  test('TC-BF-HOME-010-01-P01 search valid item code displays result @sanity @positive', async ({
    authenticatedPage,
    productSearchPage,
    page,
  }, testInfo) => {
    const item = process.env.EA_VALID_ITEM_CODE;
    test.skip(!item, 'EA_VALID_ITEM_CODE not configured');

    await authenticatedPage.openItemSearch();
    await productSearchPage.expectPageReady();
    await productSearchPage.searchAndVerifyProduct(item!);
    await attachEvidence(page, testInfo, 'product-search-result-visible');
  });

  test('TC-BF-HOME-010-01-N01 invalid item code handled @regression', async ({
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

  test('TC-BF-HOME-010-01-E01 scan control is present @regression', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.openItemSearch();
    await expect(page.locator('#B24029796092184015, button[aria-label="Scan"]')).toBeVisible();
  });
});
