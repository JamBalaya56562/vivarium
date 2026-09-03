import { defineConfig, devices } from '@playwright/test';

export const DOCS_PORT = 8770;
export const DOCS_BASE = `http://localhost:${DOCS_PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,

  retries: process.env.CI ? 2 : 0,

  timeout: 90_000,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: DOCS_BASE,
    locale: 'en-US',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: `bun run build && bun x rspress preview --port ${DOCS_PORT}`,
    url: `${DOCS_BASE}/vivarium/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
