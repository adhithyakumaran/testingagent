import { expect, type Locator, type Page } from '@playwright/test';
import type { HomeTileMatrixEntry } from '../data/home-tile-matrix';

/** Resolve teammate-style assertion targets without importing teammate repo. */
export function destinationLocator(page: Page, entry: HomeTileMatrixEntry): Locator {
  const nav = entry.navigation;
  if (!nav) {
    throw new Error(`Tile "${entry.name}" has no navigation contract`);
  }

  const key = nav.teammateLocatorKey;
  if (key === 'brandInCurrentFilters') {
    return page.getByLabel('Current filters').getByText(nav.assertValue).first();
  }
  if (key === 'itemSearchTextbox') {
    return page.getByRole('textbox', { name: /Item Search/i });
  }
  if (key === 'lotNumberTextbox') {
    return page.getByRole('textbox', { name: /LOT Number/i });
  }
  if (key === 'makeOwnCatalogueButton') {
    return page.getByRole('button', { name: /Make your own catalogue/i });
  }
  if (key === 'rivaahMenuItem') {
    return page.getByRole('menuitem', { name: /Rivaah/i });
  }
  if (key === 'customerOrderHeading') {
    return page.getByRole('heading', { name: /Customer Order Management/i });
  }
  if (key === 'goldKaratageHeading') {
    return page.getByRole('heading', { name: /Gold Karatage/i });
  }
  if (key === 'ibtHeading') {
    return page.getByRole('heading', { name: /Inter Boutique Transfer/i });
  }
  if (key === 'customerWishlistText') {
    return page.getByText(/Customer with Wishlist Items/i);
  }
  if (key === 'scanButton') {
    return page.getByRole('button', { name: /^Scan$/i });
  }
  if (key === 'shubhGoldText') {
    return page.getByText(/SHUBH GOLD EXPRESS/i);
  }
  if (key === 'homeDeliveryText') {
    return page.getByText(/HomeHome Delivery Breadcrumb/i);
  }
  if (key === 'chatbotText') {
    return page.getByText(/GenAI Agents for APEX Inbuilt/i);
  }
  if (key === 'browseStoreStockPopupText') {
    return page.getByText(/Welcome to TBO\.\. Please Scan/i);
  }
  if (key === 'smartImageSearchHeading') {
    return page.locator('#search-with-image_heading, [id*="search-with-image"]').first();
  }
  if (key === 'estimationSlipHeading') {
    return page.getByText(/Estimation Slip/i).first();
  }
  if (key === 'solitaireUinHeading') {
    return page.getByText(/UIN Search/i).first();
  }
  if (key === 'itemSearchHeading') {
    return page.getByText(/Product Search/i).first();
  }

  if (nav.assertKind === 'containsText') {
    return page.getByText(nav.assertValue).first();
  }
  return page.getByText(nav.assertValue).first();
}

export async function assertHomeTileDestination(page: Page, entry: HomeTileMatrixEntry): Promise<void> {
  const nav = entry.navigation;
  if (!nav) throw new Error(`Missing navigation for ${entry.name}`);

  if (nav.assertKind === 'urlIncludes') {
    await expect(page, `Tile "${entry.name}" URL should include ${nav.assertValue}`).toHaveURL(
      new RegExp(escapeRegExp(nav.assertValue)),
      { timeout: 25_000 }
    );
    return;
  }

  const locator = destinationLocator(page, entry);
  if (nav.assertKind === 'containsText') {
    await expect(locator, `Tile "${entry.name}" should contain "${nav.assertValue}"`).toContainText(
      nav.assertValue,
      { timeout: 25_000 }
    );
    return;
  }

  await expect(locator, `Tile "${entry.name}" destination should show "${nav.assertValue}"`).toBeVisible({
    timeout: 25_000,
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
