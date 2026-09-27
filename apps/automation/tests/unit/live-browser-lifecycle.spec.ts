import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { emitLiveFixtureStage } from '../../src/core/live-fixture-diagnostics';
import { resetLiveBrowserClosedForTests, spawnKeepOpenKeeper } from '../../src/core/live-browser-lifecycle';
import {
  getLiveRunDiagnostics,
  getSharedLiveContext,
  recordInitialLivePageIfNeeded,
  recordLiveBrowserLaunch,
  recordLiveLogin,
  resetLiveBrowserSharedForTests,
  setSharedLiveContext,
} from '../../src/core/live-browser-shared';
import { emitLiveRunMarker } from '../../src/core/live-run-log';

test.describe('live browser lifecycle', () => {
  test.afterEach(() => {
    resetLiveBrowserClosedForTests();
    resetLiveBrowserSharedForTests();
  });

  test('shared context registry reuses profile key', async () => {
    expect(getSharedLiveContext()).toBeNull();
    const fake = { pages: () => [] } as unknown as import('@playwright/test').BrowserContext;
    process.env.QA_LIVE_PROFILE_DIR = path.join(process.cwd(), 'reports', 'live-fixture-test-profile');
    setSharedLiveContext(fake);
    expect(getSharedLiveContext()).toBe(fake);
    resetLiveBrowserSharedForTests();
    expect(getSharedLiveContext()).toBeNull();
  });

  test('keeper script exists for QA_KEEP_BROWSER_OPEN close contract', async () => {
    const keeper = path.resolve(__dirname, '../../scripts/live-browser-keeper.mjs');
    expect(fs.existsSync(keeper)).toBeTruthy();
  });

  test('live batch runner script exists for collapsed LIVE_DEMO commands', async () => {
    const batch = path.resolve(__dirname, '../../scripts/run-live-playwright.mjs');
    expect(fs.existsSync(batch)).toBeTruthy();
    const text = fs.readFileSync(batch, 'utf8');
    expect(text).toContain('--workers=1');
    expect(text).toContain('LIVE_RUN:RUN_START');
  });

  test('live run diagnostics counters track launch login page close', async () => {
    recordLiveBrowserLaunch();
    recordLiveLogin();
    recordInitialLivePageIfNeeded();
    recordInitialLivePageIfNeeded();
    const diag = getLiveRunDiagnostics();
    expect(diag.browser_launch_count).toBe(1);
    expect(diag.context_launch_count).toBe(1);
    expect(diag.login_count).toBe(1);
    expect(diag.page_count).toBe(1);
    expect(diag.browser_close_count).toBe(0);
  });

  test('live run markers emit structured stderr', async () => {
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      emitLiveRunMarker('FLOW_START', 'BF-HOME-010');
      emitLiveRunMarker('FLOW_END', 'BF-HOME-010');
    } finally {
      process.stderr.write = orig;
    }
    expect(lines.some((l) => l.includes('LIVE_RUN:FLOW_START BF-HOME-010'))).toBeTruthy();
    expect(lines.some((l) => l.includes('LIVE_RUN:FLOW_END BF-HOME-010'))).toBeTruthy();
  });

  test('spawnKeepOpenKeeper returns immediately', async () => {
    const profile = path.join(process.cwd(), 'reports', 'live-keeper-perf-profile');
    fs.mkdirSync(profile, { recursive: true });
    process.env.QA_LIVE_PROFILE_DIR = profile;
    const t0 = Date.now();
    spawnKeepOpenKeeper();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test('live fixture diagnostics emit structured stderr markers', async () => {
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      emitLiveFixtureStage('before_launch');
      emitLiveFixtureStage('ready_to_return');
    } finally {
      process.stderr.write = orig;
    }
    expect(lines.some((l) => l.includes('LIVE_FIXTURE:before_launch'))).toBeTruthy();
    expect(lines.some((l) => l.includes('LIVE_FIXTURE:ready_to_return'))).toBeTruthy();
  });
});
