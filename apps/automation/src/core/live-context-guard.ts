import type { BrowserContext } from '@playwright/test';
import { recordLiveBrowserClose, recordLivePageCreated } from './live-browser-shared';

let teardownCloseAllowed = false;

export function allowLiveRunTeardownClose(): void {
  teardownCloseAllowed = true;
}

export function resetLiveContextGuardForTests(): void {
  teardownCloseAllowed = false;
}

export function isLiveRunTeardownCloseAllowed(): boolean {
  return teardownCloseAllowed;
}

/** Prevent flows/tests from closing the shared LIVE browser until run teardown. */
export function guardSharedLiveContext(context: BrowserContext): BrowserContext {
  const originalClose = context.close.bind(context);
  context.close = async (...args: Parameters<BrowserContext['close']>) => {
    if (!teardownCloseAllowed) {
      process.stderr.write('LIVE_RUN:blocked_context_close\n');
      return;
    }
    recordLiveBrowserClose();
    return originalClose(...args);
  };

  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args: Parameters<BrowserContext['newPage']>) => {
    const page = await originalNewPage(...args);
    recordLivePageCreated();
    return page;
  };

  return context;
}
