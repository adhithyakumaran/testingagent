/**
 * Live demo fixtures — persistent Chrome profile + page objects for real headed runs.
 */
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { captureStepEvidence, wrapPageWithEvidence } from '../core/evidence';
import { emitLiveEvent } from '../core/live-events';
import { emitLiveFixtureStage } from '../core/live-fixture-diagnostics';
import { launchLiveContext } from '../core/live-launch-context';
import {
  noteKeepOpenBrowserLeftRunning,
  spawnKeepOpenKeeper,
  writeSessionMeta,
} from '../core/live-browser-lifecycle';
import { ensureRunScopedLogin } from '../core/live-run-scoped-auth';
import { allowLiveRunTeardownClose } from '../core/live-context-guard';
import {
  getLiveRunDiagnostics,
  isLiveSessionAuthenticated,
  markLiveSessionAuthenticated,
  recordInitialLivePageIfNeeded,
  setSharedLiveContext,
} from '../core/live-browser-shared';
import {
  emitLiveRunDiagnostics,
  emitLiveRunMarker,
  flowIdFromTestTags,
} from '../core/live-run-log';
import { ensureAuthenticated } from './auth';
import { LoginPage } from '../pages/login.page';
import { HomePage } from '../pages/home.page';
import { ProductSearchPage } from '../pages/product-search.page';
import { StockVisibilityPage } from '../pages/stock-visibility.page';

const keepOpen = () => process.env.QA_KEEP_BROWSER_OPEN === 'true';

let runStartLogged = false;

type Fixtures = {
  liveContext: BrowserContext;
  liveSession: boolean;
  loginPage: LoginPage;
  homePage: HomePage;
  productSearchPage: ProductSearchPage;
  stockVisibilityPage: StockVisibilityPage;
  authenticatedPage: HomePage;
  recordStep: (label: string) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  liveContext: [
    async ({}, use) => {
      if (!runStartLogged) {
        runStartLogged = true;
        emitLiveRunMarker('RUN_START');
      }
      const context = await launchLiveContext();
      await emitLiveEvent({ phase: 'BROWSER', action: 'LAUNCH', status: 'OK' });
      writeSessionMeta({
        status: 'ACTIVE',
        keep_open: keepOpen(),
        run_id: process.env.QA_RUN_ID || '',
        diagnostics: getLiveRunDiagnostics(),
      });
      emitLiveFixtureStage('ready_to_return');
      await use(context);
      emitLiveFixtureStage('teardown_returning');
      writeSessionMeta({ diagnostics: getLiveRunDiagnostics() });
      if (!keepOpen()) {
        allowLiveRunTeardownClose();
        await context.close();
        setSharedLiveContext(null);
        emitLiveRunMarker('browser_closed');
        emitLiveRunDiagnostics(getLiveRunDiagnostics());
        emitLiveRunMarker('RUN_END');
      } else {
        noteKeepOpenBrowserLeftRunning();
        spawnKeepOpenKeeper();
        emitLiveFixtureStage('keeper_started');
      }
    },
    { scope: 'worker', timeout: 30_000 },
  ],
  liveSession: [
    async ({ liveContext }, use) => {
      emitLiveFixtureStage('login_started');
      await ensureRunScopedLogin(liveContext);
      emitLiveFixtureStage('login_completed');
      await use(true);
    },
    { scope: 'worker' },
  ],
  page: async ({ liveContext, liveSession }, use, testInfo) => {
    void liveSession;
    const flowId = flowIdFromTestTags(testInfo.tags, testInfo.title);
    emitLiveRunMarker('FLOW_START', flowId);
    const title = flowId ? `ScoutAI Live QA — ${flowId}` : 'ScoutAI Live QA';
    let page = liveContext.pages()[0];
    if (!page) {
      page = await liveContext.newPage();
    } else {
      recordInitialLivePageIfNeeded();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    try {
      await page.setTitle(title);
    } catch {
      /* ignore */
    }
    wrapPageWithEvidence(page, testInfo, { liveEvents: true });
    await captureStepEvidence(page, testInfo, 'test-start');
    await use(page);
    await captureStepEvidence(page, testInfo, 'test-end');
    emitLiveRunMarker('FLOW_END', flowId);
    if (!keepOpen()) {
      await page.close();
    } else {
      await page.bringToFront();
    }
  },
  recordStep: async ({ page }, use, testInfo) => {
    await use(async (label: string) => {
      await captureStepEvidence(page, testInfo, label);
    });
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  productSearchPage: async ({ page }, use) => {
    await use(new ProductSearchPage(page));
  },
  stockVisibilityPage: async ({ page }, use) => {
    await use(new StockVisibilityPage(page));
  },
  authenticatedPage: async ({ page, homePage }, use) => {
    const user = process.env.EA_USER_USERNAME;
    const pass = process.env.EA_USER_PASSWORD;
    if (!user || !pass) {
      test.skip(true, 'EA_USER_USERNAME / EA_USER_PASSWORD not configured');
    }
    if (isLiveSessionAuthenticated()) {
      await expect(page).toHaveURL(/\/home/i, { timeout: 10_000 });
      await use(homePage);
      return;
    }
    await ensureAuthenticated(page);
    markLiveSessionAuthenticated();
    await expect(page).toHaveURL(/\/home/i, { timeout: 30_000 });
    await use(homePage);
  },
});

export { expect };
