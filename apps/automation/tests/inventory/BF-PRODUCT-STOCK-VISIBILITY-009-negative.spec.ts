import { test, expect } from '../../src/fixtures/test-base';

test.describe('BF-PRODUCT-STOCK-VISIBILITY-009 @BF-PRODUCT-STOCK-VISIBILITY-009 @negative @inventory', () => {
  test('TC-BF-PRODUCT-STOCK-VISIBILITY-009-N01 incomplete item code shows validation @negative', async ({
    stockVisibilityPage,
    homePage,
    page,
  }) => {
    await stockVisibilityPage.open(homePage);
    await stockVisibilityPage.searchItemCode('123');
    await expect(page.locator('text=/14 Digit|Item code/i')).toBeVisible({ timeout: 10_000 });
  });

  test('TC-BF-PRODUCT-STOCK-VISIBILITY-009-N02 invalid 14-digit code shows no stock result @negative', async ({
    stockVisibilityPage,
    homePage,
    page,
  }) => {
    const invalid = process.env.EA_INVALID_ITEM_CODE ?? '00000000000000';
    await stockVisibilityPage.open(homePage);
    await stockVisibilityPage.searchItemCode(invalid);
    const body = await page.innerText('body');
    expect(body.toLowerCase()).toMatch(/sold out|not in stock|no data|not found|0 result|no record/);
  });
});
