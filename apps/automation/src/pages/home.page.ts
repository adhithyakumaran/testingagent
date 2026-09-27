import { expect, type Page } from '@playwright/test';
import { appUrl } from '../core/app-url';
import { dismissBlockingOverlays } from '../core/apex-overlays';
import { assertHomeTileDestination } from '../core/home-tile-assert';
import type { HomeTileMatrixEntry } from '../data/home-tile-matrix';
import { LOCATORS, LocatorResolver } from '../core/locator-chain';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match home card label exactly — avoids "Gold Coin Stock Visibility" when asking for "Stock Visibility". */
export function locateHomeCard(page: Page, cardText: string) {
  const exact = new RegExp(`^\\s*${escapeRegExp(cardText)}\\s*$`, 'i');
  return page.locator('a.custom-card-wrap, li.custom-card-item a').filter({ hasText: exact });
}

export class HomePage {
  private readonly resolver: LocatorResolver;

  constructor(private readonly page: Page) {
    this.resolver = new LocatorResolver(page);
  }

  async openCardByText(cardText: string, fallbackUrl?: string): Promise<void> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 });

    const card = locateHomeCard(this.page, cardText);

    try {
      await card.first().waitFor({ state: 'visible', timeout: 12_000 });
      await card.first().scrollIntoViewIfNeeded();
      await dismissBlockingOverlays(this.page);
      await card.first().click({ force: true, timeout: 10_000 });
      return;
    } catch {
      if (!fallbackUrl) throw new Error(`Home card "${cardText}" not found or not clickable`);
      await this.page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
  }

  async openItemSearch(): Promise<void> {
    await this.openCardByText('Item Search', appUrl('product-detail-item-search?clear=6'));
  }

  async openProductStockVisibility(): Promise<void> {
    await this.openCardByText('Stock Visibility', appUrl('product-stock-visibility?clear=114'));
  }

  async openRivaahFromNav(): Promise<void> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 });

    const nav = await this.resolver.firstVisible(
      [
        ...LOCATORS.rivaah.nav,
        'a.a-MenuBar-label:has-text("Rivaah")',
        '.t-Header-nav-list a:has-text("Rivaah")',
        'text=Rivaah',
      ],
      'Rivaah nav',
      15_000
    );
    await nav.click({ force: true });
  }

  async signOut(): Promise<void> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 }).catch(() => undefined);

    const menu = await this.resolver.firstVisible([...LOCATORS.userMenu.menu], 'user menu', 10_000);
    await menu.click({ force: true });
    await dismissBlockingOverlays(this.page);

    // APEX keeps Sign Out in DOM but hidden until menu opens — navigate via logout href instead of clicking invisible item
    await this.page
      .locator("a[href*='apex_authentication.logout']")
      .first()
      .waitFor({ state: 'attached', timeout: 5_000 })
      .catch(() => undefined);

    const logoutUrl = await this.resolveLogoutUrl();
    if (!logoutUrl) {
      throw new Error('Could not resolve APEX logout URL after opening user menu');
    }

    await this.page.goto(logoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await this.page.waitForURL(/login/i, { timeout: 30_000, waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(this.page);
  }

  /** APEX logout href from user menu, or built from the active session id in the current URL. */
  private async resolveLogoutUrl(): Promise<string | null> {
    const href = await this.page
      .locator("a[href*='apex_authentication.logout']")
      .first()
      .getAttribute('href')
      .catch(() => null);

    const origin = new URL(this.page.url()).origin;

    if (href) {
      if (/^https?:\/\//i.test(href)) return href;
      if (href.startsWith('/')) return `${origin}${href}`;
      return `${origin}/ords/${href.replace(/^\/?/, '')}`;
    }

    const sessionMatch = this.page.url().match(/[?&]session=(\d+)/i);
    if (sessionMatch) {
      return `${origin}/ords/apex_authentication.logout?p_app_id=1002&p_session_id=${sessionMatch[1]}`;
    }

    return null;
  }

  async openCustomerDrawer(): Promise<void> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 }).catch(() => undefined);
    const customer = await this.resolver.firstVisible([...LOCATORS.home.customer], 'customer selector', 10_000);
    await customer.click({ force: true });
  }

  async openSettings(): Promise<void> {
    await dismissBlockingOverlays(this.page);
    const menu = await this.resolver.firstVisible([...LOCATORS.userMenu.menu], 'user menu', 10_000);
    await menu.click({ force: true });
    await dismissBlockingOverlays(this.page);
    const settings = await this.resolver.firstVisible([...LOCATORS.userMenu.settings], 'settings', 10_000);
    await settings.click({ force: true });
  }

  /** Home navigation hub cards (BF-HOME-010 Smoke V2–V6). */
  homeCardLinks() {
    return this.page.locator('a.custom-card-wrap, li.custom-card-item a');
  }

  tileLink(name: string) {
    const card = locateHomeCard(this.page, name);
    return card.first();
  }

  async getHomeTileCount(): Promise<number> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 });
    return this.homeCardLinks().count();
  }

  async getHomeTileNames(): Promise<string[]> {
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 15_000 });
    const cards = this.homeCardLinks();
    const count = await cards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const heading = cards.nth(i).locator('h3').first();
      const text = (await heading.textContent().catch(() => '')) ?? '';
      const trimmed = text.trim();
      if (trimmed) names.push(trimmed);
    }
    return names;
  }

  async expectTileImageVisible(tileName: string): Promise<void> {
    const card = this.tileLink(tileName);
    await expect(card, `Tile "${tileName}" card should be visible`).toBeVisible({ timeout: 12_000 });
    await expect(
      card.getByRole('img').first(),
      `Tile "${tileName}" should have a visible card image`
    ).toBeVisible({ timeout: 12_000 });
  }

  async clickHomeTile(name: string): Promise<void> {
    await dismissBlockingOverlays(this.page);
    const link = this.tileLink(name);
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.scrollIntoViewIfNeeded();
    await link.click({ force: true, timeout: 10_000 });
  }

  async returnToHome(homeUrl: string): Promise<void> {
    await this.page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissBlockingOverlays(this.page);
    await this.page.waitForURL(/\/home/i, { timeout: 30_000 });
  }

  /**
   * Teammate Smoke Flow 1 V6 — navigate tile and assert destination; return to home when configured.
   */
  async verifyTileNavigation(entry: HomeTileMatrixEntry, homeUrl: string): Promise<void> {
    if (entry.automation !== 'automated' || !entry.navigation) {
      throw new Error(`Tile "${entry.name}" is not approved for automated navigation`);
    }

    const nav = entry.navigation;
    if (nav.opensNewTab) {
      const popupPromise = this.page.waitForEvent('popup');
      await this.clickHomeTile(entry.name);
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
      await assertHomeTileDestination(popup, entry);
      await popup.close();
      return;
    }

    await this.clickHomeTile(entry.name);
    await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await assertHomeTileDestination(this.page, entry);
    if (entry.returnToHomeAfterNav) {
      await this.returnToHome(homeUrl);
    }
  }
}
