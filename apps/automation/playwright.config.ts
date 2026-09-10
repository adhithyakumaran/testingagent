import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, 'config', '.env') });
dotenv.config({ path: path.resolve(__dirname, 'config', '.env.local'), override: true });

const baseURL = (() => {
  const raw = process.env.EA_BASE_URL ?? 'https://uat.example.com/ords/r/tjdcom/ea';
  return raw.trim().replace(/\/+$/, '').replace(/\/login\/?$/i, '');
})();

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
  ],
  outputDir: 'reports/test-results',
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL,
    storageState: process.env.EA_USER_USERNAME ? '.auth/user.json' : undefined,
    headless: process.env.EA_HEADLESS !== 'false',
    trace: process.env.QA_HEADED === 'true' ? 'on' : 'retain-on-failure',
    screenshot: process.env.QA_HEADED === 'true' ? 'on' : 'only-on-failure',
    video: process.env.QA_HEADED === 'true' ? 'on' : 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ignoreHTTPSErrors: process.env.EA_IGNORE_HTTPS_ERRORS === 'true',
  },
  projects: [
    {
      name: 'chromium-uat',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.EA_USE_SYSTEM_CHROME === 'false' ? undefined : 'chrome',
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
  ],
});
