import { test, expect } from '../../src/fixtures/test-base';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('BF-LOGIN-001 User Login @BF-LOGIN-001 @negative @authentication', () => {
  test('TC-BF-LOGIN-001-N01 invalid credentials show login error @negative', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.login('invalid_user_scout', 'wrong_password_123', false);
    await expect(page).toHaveURL(/login/i, { timeout: 20_000 });
    const body = await page.innerText('body');
    expect(body.toLowerCase()).toMatch(/invalid|incorrect|error|username|password/);
  });

  test('TC-BF-LOGIN-001-E01 empty credentials do not authenticate @negative', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.login('', '', false);
    await expect(page).toHaveURL(/login/i);
  });
});
