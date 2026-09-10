import { chromium, type FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { launchUatBrowser, newUatContext } from './src/core/browser-launch';
import { loginUrl, normalizeBaseUrl } from './src/core/app-url';
import {
  dumpLoginFailure,
  performLogin,
} from './src/core/login-setup';

dotenv.config({ path: path.resolve(__dirname, 'config', '.env') });

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = normalizeBaseUrl(
    process.env.EA_BASE_URL ?? (config.projects[0]?.use?.baseURL as string)
  );
  const user = process.env.EA_USER_USERNAME;
  const pass = process.env.EA_USER_PASSWORD;
  if (!user || !pass) {
    console.warn('Skipping auth storage — EA_USER_USERNAME/PASSWORD not set');
    return;
  }

  // Auth capture always runs headless so headed test runs don't flash a login window.
  const browser = await launchUatBrowser(true);
  const context = await newUatContext(browser, baseURL);
  const page = await context.newPage();
  const loginTarget = loginUrl();
  console.log(`Global setup: login ${loginTarget} as ${user} (headless=true)`);

  try {
    await page.goto(loginTarget, { waitUntil: 'load', timeout: 90_000 });
    await performLogin(page, user, pass);
    const authDir = path.resolve(__dirname, '.auth');
    fs.mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: path.join(authDir, 'user.json') });
    console.log('Global setup: saved .auth/user.json');
  } catch (error) {
    const reportsDir = path.resolve(__dirname, 'reports');
    const detail = await dumpLoginFailure(
      page,
      reportsDir,
      error instanceof Error ? error.message : String(error)
    );
    throw new Error(`Global login setup failed:\n${detail}`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
