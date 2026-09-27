import { chromium, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { emitLiveEvent } from './live-events';
import { emitLiveFixtureStage } from './live-fixture-diagnostics';
import { readSessionMetaFromDisk, writeSessionMeta } from './live-browser-lifecycle';
import { guardSharedLiveContext } from './live-context-guard';
import {
  getLiveRunDiagnostics,
  getSharedLiveContext,
  recordLiveBrowserLaunch,
  recordLiveContextAttach,
  recordInitialLivePageIfNeeded,
  setSharedLiveContext,
} from './live-browser-shared';

const CDP_ATTACH_MS = 8_000;

function devToolsPort(profileDir: string): string | null {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) return null;
  const line = fs.readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
  return line || null;
}

async function connectOverCdpWithTimeout(port: string): Promise<Awaited<ReturnType<typeof chromium.connectOverCDP>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('CDP_ATTACH_TIMEOUT')), CDP_ATTACH_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function attachExistingLiveContext(profileDir: string): Promise<BrowserContext | null> {
  const runId = process.env.QA_RUN_ID || '';
  const meta = readSessionMetaFromDisk(profileDir);
  const port = devToolsPort(profileDir);
  if (!port) return null;
  if (meta.status !== 'ACTIVE' && meta.status !== 'STARTING') return null;
  if (meta.run_id && runId && meta.run_id !== runId) {
    throw new Error(
      'LIVE_BROWSER_STALE: Active browser on this profile belongs to another run. Use Close Browser first.'
    );
  }
  try {
    const browser = await connectOverCdpWithTimeout(port);
    const context = browser.contexts()[0];
    if (!context) return null;
    recordLiveContextAttach();
    setSharedLiveContext(guardSharedLiveContext(context));
    emitLiveFixtureStage('context_attached');
    writeSessionMeta({
      attached_via_cdp: true,
      run_id: runId || meta.run_id,
      diagnostics: getLiveRunDiagnostics(),
    });
    return context;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('CDP_ATTACH_TIMEOUT') || port) {
      throw new Error(
        'LIVE_BROWSER_STALE: Existing Chrome did not respond over CDP. Use Close Browser before retrying.'
      );
    }
    return null;
  }
}

/** Launch or attach the single LIVE_DEMO persistent context (no login, no keeper). */
export async function launchLiveContext(): Promise<BrowserContext> {
  emitLiveFixtureStage('before_launch');
  const existing = getSharedLiveContext();
  if (existing) {
    emitLiveFixtureStage('context_created');
    return existing;
  }

  const profileDir =
    process.env.QA_LIVE_PROFILE_DIR || path.resolve('reports/browser-profiles/default-live');
  fs.mkdirSync(profileDir, { recursive: true });

  const attached = await attachExistingLiveContext(profileDir);
  if (attached) {
    await emitLiveEvent({
      phase: 'BROWSER',
      action: 'ATTACH',
      status: 'OK',
      value_summary: 'Reused persistent Chrome via CDP',
    });
    emitLiveFixtureStage('browser_launched');
    emitLiveFixtureStage('context_created');
    recordInitialLivePageIfNeeded();
    return attached;
  }

  const port = devToolsPort(profileDir);
  const meta = readSessionMetaFromDisk(profileDir);
  if (port && meta.keep_open && meta.status === 'ACTIVE') {
    throw new Error(
      'LIVE_BROWSER_STALE: Browser still active on this profile. Use Close Browser before launching again.'
    );
  }

  const channel = process.env.QA_BROWSER_CHANNEL || process.env.EA_BROWSER_CHANNEL || 'chrome';
  const headless = process.env.QA_BROWSER_HEADLESS === 'true';
  const slowMo = Number(process.env.QA_LIVE_ACTION_DELAY_MS || 0);
  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      channel,
      headless,
      slowMo,
      args: ['--disable-blink-features=AutomationControlled'],
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: process.env.EA_IGNORE_HTTPS_ERRORS === 'true',
    });
    recordLiveBrowserLaunch();
    setSharedLiveContext(guardSharedLiveContext(context));
    recordInitialLivePageIfNeeded();
    emitLiveFixtureStage('browser_launched');
    emitLiveFixtureStage('context_created');
    writeSessionMeta({
      run_id: process.env.QA_RUN_ID || '',
      diagnostics: getLiveRunDiagnostics(),
    });
    return context;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSessionMeta({ status: 'BROWSER_UNAVAILABLE', error: message });
    throw new Error(`BROWSER_UNAVAILABLE: ${message}`);
  }
}
