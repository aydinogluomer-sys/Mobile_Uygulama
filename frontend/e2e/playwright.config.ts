import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(__dirname, '..', 'test-results'),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, '..', 'playwright-report') }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/support/serveDist.mjs',
    cwd: path.join(__dirname, '..'),
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    { name: 'mobile-375', use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } } },
    { name: 'reduced-motion-375', use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' } },
    { name: 'tablet-768', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'desktop-1366', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
  ],
});
