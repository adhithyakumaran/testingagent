import { test, expect } from '../../src/fixtures/test-base';
import { RivaahPage } from '../../src/pages/rivaah.page';
import { appUrl } from '../../src/core/app-url';

test.describe('BF-RIVAAH-005 Rivaah @BF-RIVAAH-005 @negative @rivaah', () => {
  test.describe('unauthenticated access', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC-BF-RIVAAH-005-N01 unauthenticated rivaah URL redirects to login @negative', async ({ page }) => {
      await page.goto(appUrl('rivaah?clear=38'));
      await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
    });
  });

  test('TC-BF-RIVAAH-005-E01 back from rivaah preserves authenticated session @negative', async ({
    page,
    homePage,
  }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await expect(page).toHaveURL(/rivaah/i);
    await page.goBack();
    await expect(page).toHaveURL(/home/i, { timeout: 30_000 });
  });
});

test.describe('BF-RIVAAH-005-01 Wedding Trousseau @BF-RIVAAH-005-01 @negative @rivaah', () => {
  test('TC-BF-RIVAAH-005-01-E01 back from trousseau returns to rivaah listing @negative', async ({
    page,
    homePage,
  }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('trousseauStyling');
    await expect(page).toHaveURL(/wedding-trousseau/i);
    await page.goBack();
    await expect(page).toHaveURL(/rivaah/i, { timeout: 30_000 });
  });
});

test.describe('BF-RIVAAH-005-02 Trousseau Set Image @BF-RIVAAH-005-02 @negative @rivaah', () => {
  test('TC-BF-RIVAAH-005-02-E01 back from set image returns to rivaah @negative', async ({ page, homePage }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('trousseauSetImage');
    await expect(page).toHaveURL(/wedding-trousseau1/i);
    await page.goBack();
    await expect(page).toHaveURL(/rivaah/i, { timeout: 30_000 });
  });
});

test.describe('BF-RIVAAH-005-03 Engagement Rings @BF-RIVAAH-005-03 @negative @rivaah', () => {
  test('TC-BF-RIVAAH-005-03-E01 back from engagement rings returns to rivaah @negative', async ({
    page,
    homePage,
  }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('engagementRings');
    await expect(page).toHaveURL(/standard-product-search/i);
    await page.goBack();
    await expect(page).toHaveURL(/rivaah/i, { timeout: 30_000 });
  });
});

test.describe('BF-RIVAAH-005-04 Wedding Experts @BF-RIVAAH-005-04 @negative @rivaah', () => {
  test('TC-BF-RIVAAH-005-04-E01 wedding experts page loads without region selection @negative', async ({
    page,
    homePage,
  }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('weddingExperts');
    await expect(page).toHaveURL(/wedding-experts/i);
    const body = await page.innerText('body');
    expect(body.length).toBeGreaterThan(0);
  });
});

test.describe('BF-RIVAAH-005-05 Wedding Wishlist @BF-RIVAAH-005-05 @negative @rivaah', () => {
  test('TC-BF-RIVAAH-005-05-N01 proceed without customer shows validation @negative', async ({
    page,
    homePage,
  }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('weddingWishlist');
    await expect(page).toHaveURL(/dreams-in-gold/i);
    const proceed = page.locator(
      'button:has-text("Proceed"), button:has-text("Dream List"), a:has-text("Proceed")'
    );
    if (await proceed.count()) {
      await proceed.first().click();
      const body = await page.innerText('body');
      expect(body.toLowerCase()).toMatch(/customer|select|required|mandatory/);
    }
  });

  test('TC-BF-RIVAAH-005-05-E01 back from wishlist returns to rivaah @negative', async ({ page, homePage }) => {
    const rivaah = new RivaahPage(page);
    await rivaah.open(homePage);
    await rivaah.openCard('weddingWishlist');
    await expect(page).toHaveURL(/dreams-in-gold/i);
    await page.goBack();
    await expect(page).toHaveURL(/rivaah/i, { timeout: 30_000 });
  });
});
