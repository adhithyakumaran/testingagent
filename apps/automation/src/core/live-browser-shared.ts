import type { BrowserContext } from '@playwright/test';

let sharedContext: BrowserContext | null = null;
let sharedProfileKey: string | null = null;
let sessionAuthenticated = false;
let initialPageCounted = false;

export type LiveRunDiagnostics = {
  browser_launch_count: number;
  context_launch_count: number;
  login_count: number;
  context_attach_count: number;
  page_count: number;
  browser_close_count: number;
};

const counters: LiveRunDiagnostics = {
  browser_launch_count: 0,
  context_launch_count: 0,
  login_count: 0,
  context_attach_count: 0,
  page_count: 0,
  browser_close_count: 0,
};

export function liveProfileKey(): string {
  return process.env.QA_LIVE_PROFILE_DIR || 'default-live';
}

export function getSharedLiveContext(): BrowserContext | null {
  if (sharedProfileKey !== liveProfileKey()) return null;
  return sharedContext;
}

export function setSharedLiveContext(context: BrowserContext | null): void {
  sharedContext = context;
  sharedProfileKey = context ? liveProfileKey() : null;
  if (!context) sessionAuthenticated = false;
}

export function isLiveSessionAuthenticated(): boolean {
  return sessionAuthenticated;
}

export function markLiveSessionAuthenticated(): void {
  sessionAuthenticated = true;
}

export function recordLiveBrowserLaunch(): void {
  counters.browser_launch_count += 1;
  counters.context_launch_count += 1;
}

export function recordLiveContextAttach(): void {
  counters.context_attach_count += 1;
  counters.context_launch_count += 1;
}

export function recordLiveLogin(): void {
  counters.login_count += 1;
}

export function recordLivePageCreated(): void {
  counters.page_count += 1;
}

/** Count the first tab created with the persistent context (not via newPage). */
export function recordInitialLivePageIfNeeded(): void {
  if (initialPageCounted) return;
  initialPageCounted = true;
  counters.page_count += 1;
}

export function recordLiveBrowserClose(): void {
  counters.browser_close_count += 1;
}

export function getLiveRunDiagnostics(): LiveRunDiagnostics {
  return { ...counters };
}

export function resetLiveRunDiagnosticsForTests(): void {
  counters.browser_launch_count = 0;
  counters.context_launch_count = 0;
  counters.login_count = 0;
  counters.context_attach_count = 0;
  counters.page_count = 0;
  counters.browser_close_count = 0;
}

export function resetLiveBrowserSharedForTests(): void {
  sharedContext = null;
  sharedProfileKey = null;
  sessionAuthenticated = false;
  initialPageCounted = false;
  resetLiveRunDiagnosticsForTests();
}
