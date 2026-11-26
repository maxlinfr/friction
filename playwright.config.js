// Engine tests run in WebKit only: the app is a WKWebView, so WebKit is the engine that matters.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // tests are meant to be deterministic (fake clock); a retry would hide flakiness
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
