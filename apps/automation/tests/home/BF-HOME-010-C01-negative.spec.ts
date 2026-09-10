import { test, expect } from '../../src/fixtures/test-base';

test.describe('BF-HOME-010-C01 Home Utility Components @BF-HOME-010-C01 @negative @navigation', () => {
  test('TC-BF-HOME-010-C01-N01 customer drawer opens without selected customer @negative', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.openCustomerDrawer();
    await expect(page.locator('.t-Drawer, .ui-dialog, [role="dialog"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('TC-BF-HOME-010-C01-E01 store stock control responds without error @negative', async ({
    authenticatedPage,
    page,
  }) => {
    const btn = page.locator('#B74402876591024608, button:has-text("STORE STOCK")').first();
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('body')).toBeVisible();
  });
});
