import { test, expect } from '@playwright/test';
import {
  allowLiveRunTeardownClose,
  guardSharedLiveContext,
  isLiveRunTeardownCloseAllowed,
  resetLiveContextGuardForTests,
} from '../../src/core/live-context-guard';
import {
  getLiveRunDiagnostics,
  resetLiveBrowserSharedForTests,
} from '../../src/core/live-browser-shared';

test.describe('live context close guard', () => {
  test.afterEach(() => {
    resetLiveContextGuardForTests();
    resetLiveBrowserSharedForTests();
  });

  test('blocks context.close until run teardown is allowed', async () => {
    let closeCalls = 0;
    const fake = {
      close: async () => {
        closeCalls += 1;
      },
      newPage: async () => ({}) as import('@playwright/test').Page,
      pages: () => [],
    } as unknown as import('@playwright/test').BrowserContext;

    const guarded = guardSharedLiveContext(fake);
    await guarded.close();
    expect(closeCalls).toBe(0);
    expect(getLiveRunDiagnostics().browser_close_count).toBe(0);

    allowLiveRunTeardownClose();
    expect(isLiveRunTeardownCloseAllowed()).toBe(true);
    await guarded.close();
    expect(closeCalls).toBe(1);
    expect(getLiveRunDiagnostics().browser_close_count).toBe(1);
  });

  test('newPage increments page_count via guard wrapper', async () => {
    const fake = {
      close: async () => {},
      newPage: async () => ({}) as import('@playwright/test').Page,
      pages: () => [],
    } as unknown as import('@playwright/test').BrowserContext;
    const guarded = guardSharedLiveContext(fake);
    await guarded.newPage();
    expect(getLiveRunDiagnostics().page_count).toBe(1);
  });
});
