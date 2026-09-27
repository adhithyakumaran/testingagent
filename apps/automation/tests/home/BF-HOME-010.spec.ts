import { test, expect } from '../../src/fixtures/test-base';
import {
  HOME_TILE_EXPECTED_COUNT,
  HOME_TILE_EXPECTED_ORDER,
  HOME_TILE_MATRIX,
  HOME_TILES_AUTOMATED,
} from '../../src/data/home-tile-matrix';

test.describe('BF-HOME-010 Home Navigation Map @BF-HOME-010 @regression @navigation', () => {
  test('TC-BF-HOME-010-P01 home loads with navigation and cards @sanity', async ({ authenticatedPage, page }) => {
    await expect(page).toHaveURL(/\/home/i);
    await expect(page.locator('a.custom-card-wrap').first()).toBeVisible();
    await expect(page).toHaveTitle(/Endless Aisle/i);
  });

  test('TC-BF-HOME-010-P02 home tile count matches matrix @regression', async ({ authenticatedPage, page }) => {
    const count = await authenticatedPage.getHomeTileCount();
    expect(
      HOME_TILE_MATRIX.length,
      'Static matrix should define expected teammate tile count'
    ).toBe(HOME_TILE_EXPECTED_COUNT);
    expect.soft(count, `Home should show ${HOME_TILE_EXPECTED_COUNT} navigation tiles`).toBe(HOME_TILE_EXPECTED_COUNT);
  });

  test('TC-BF-HOME-010-P03 all expected tile names visible on home @regression', async ({
    authenticatedPage,
  }) => {
    for (const name of HOME_TILE_EXPECTED_ORDER) {
      await expect.soft(authenticatedPage.tileLink(name), `Tile heading "${name}" should be visible`).toBeVisible();
    }
  });

  test('TC-BF-HOME-010-P04 each matrix tile has a visible card image @regression', async ({
    authenticatedPage,
  }) => {
    for (const tile of HOME_TILE_MATRIX) {
      const card = authenticatedPage.tileLink(tile.name);
      await expect.soft(card, `Tile "${tile.name}" card`).toBeVisible();
      await expect.soft(card.getByRole('img').first(), `Tile "${tile.name}" image`).toBeVisible();
    }
  });

  test('TC-BF-HOME-010-P05 home tiles appear in teammate smoke order @regression', async ({
    authenticatedPage,
  }) => {
    const actual = await authenticatedPage.getHomeTileNames();
    expect.soft(
      actual,
      `Tile order mismatch.\nExpected: ${HOME_TILE_EXPECTED_ORDER.join(' | ')}\nActual: ${actual.join(' | ')}`
    ).toEqual(HOME_TILE_EXPECTED_ORDER);
  });

  test('TC-BF-HOME-010-P06 parameterized home tile navigation (automated matrix only) @regression', async ({
    authenticatedPage,
    page,
  }) => {
    test.setTimeout(300_000);
    const homeUrl = page.url();

    for (const tile of HOME_TILES_AUTOMATED) {
      try {
        await authenticatedPage.verifyTileNavigation(tile, homeUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect.soft(false, `Tile "${tile.name}" navigation failed.\n${msg}`).toBeTruthy();
        try {
          await authenticatedPage.returnToHome(homeUrl);
        } catch {
          /* continue matrix */
        }
      }
    }
  });

  test('TC-BF-HOME-010-E01 item search card navigates away from home @regression', async ({
    authenticatedPage,
    page,
  }) => {
    await authenticatedPage.openItemSearch();
    await expect(page).not.toHaveURL(/\/home$/i);
  });
});
