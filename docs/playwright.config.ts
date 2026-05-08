// Playwright configuration for the docs-site E2E suite.
//
// What this suite asserts (per ADR-0034 / docs E2E PR notes):
// - Every tracked rspress page (EN + JA, total 68) loads with HTTP 200,
//   carries a non-empty <h1>, and renders the rspress top-nav + footer.
// - The locale switcher round-trips between EN and JA on representative
//   pages.
// - A reproduction page reached via the **hierarchical** URL
//   (/repro/<project>/<issue>/) reaches its documented verdict and
//   exposes the loading-UX surface (vh-progress fades, vh-output
//   reveals on completion). This guards the regression where chrome.js
//   fails to inject silently.
// - The **legacy flat URL** (/repro/<slug>/) either redirects to the
//   hierarchical form or still serves a working page — never the
//   silent-break shape (parent HTML 200 + asset 404/503).
//
// One static HTTP server is auto-started: rspress's preview server on
// port 8770 (well clear of Layer 1=8767, Layer 2=8768). Tests address
// pages via the baseURL so the suite is portable to any deploy.
//
// Preview mode (vs dev mode) trade-off: preview serves the static
// build output (`doc_build/`), which mirrors what GitHub Pages serves
// in production. Dev mode goes through the rspress middleware in
// rspress.config.ts §builderConfig.server.setup, which is dev-only;
// the middleware is unit-tested separately under
// `scripts/__tests__/resolveReproFile.test.ts` so the E2E suite can
// stay focused on the production-shape surface.

import { defineConfig, devices } from '@playwright/test';

export const DOCS_PORT = 8770;
export const DOCS_BASE = `http://localhost:${DOCS_PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,

  // Retry once in CI to absorb transient flakes (jsDelivr fetch jitter
  // when a recipe page boots Pyodide / Ruby.wasm / php-wasm). Locally
  // retries hide bugs; run them once and fix.
  retries: process.env.CI ? 1 : 0,

  // Per-test timeout. Most docs-page assertions complete in <2 s; the
  // recipe-loading-UX cases include a Pyodide cold load and need
  // headroom.
  timeout: 90_000,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: DOCS_BASE,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Auto-start rspress preview server. The build step runs first so
  // doc_build/ is populated; the preview command then serves that
  // directory.
  webServer: {
    // `bun run build && bun run preview -- --port <PORT>` would be the
    // single-line form, but rspress's preview accepts `--port` only,
    // not via env, so we wire it up via the raw argv.
    command: `bun run build && bunx rspress preview --port ${DOCS_PORT}`,
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
  ],
});
