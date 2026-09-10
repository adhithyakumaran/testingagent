import { test, expect } from '../../src/fixtures/test-base';
import { appUrl } from '../../src/core/app-url';

test.describe('BF-ADMINISTRATION-009 Administration @BF-ADMINISTRATION-009 @negative @read-only-sanity @no-data-mutation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('TC-BF-ADMINISTRATION-009-N01 unauthenticated administration redirects to login @negative', async ({
    page,
  }) => {
    await page.goto(appUrl('administration'));
    await expect(page).toHaveURL(/login/i, { timeout: 30_000 });
  });
});
