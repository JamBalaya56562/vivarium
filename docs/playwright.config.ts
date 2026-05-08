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

  // Retry up to 2 times in CI to absorb transient engine flakes —
  // observed pattern: each Firefox / Chromium / WebKit run has its
  // own occasional miss (a single page returns a transiently empty
  // hydrated DOM, even though the SSR HTML is correct). The smoke
  // assertions read from the response body so they should be
  // race-free; the retry budget covers the rspress preview server
  // cold-start window plus jsDelivr font fetch jitter that
  // sometimes delays the first request.
  //
  // Locally (process.env.CI unset) retries stay at 0 — a flake on a
  // local run is information, not noise; run once, fix the cause.
  retries: process.env.CI ? 2 : 0,

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
    // `bun x` (subcommand form) instead of `bunx` (separate shim) —
    // Windows ships only `bun.exe`, no `bunx.cmd`, so the shim form
    // breaks local pre-flight runs on Windows. `bun x` is portable
    // across Linux / macOS / Windows.
    command: `bun run build && bun x rspress preview --port ${DOCS_PORT}`,
    url: `${DOCS_BASE}/vivarium/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // Desktop browser matrix:
  //
  // - **Chromium** covers Chrome and Microsoft Edge in one engine (both
  //   are Blink-based, so a Chromium-only run catches regressions in
  //   the majority Vivarium audience).
  // - **Firefox** (Gecko) and **WebKit** (Safari) are the other two
  //   independent rendering engines users are likely to land on.
  //   Layer 1 reproductions boot Pyodide / Ruby.wasm / php-wasm /
  //   Rust wasm32-wasip1 in-page, so any engine-level WASM / ES module
  //   / streaming-fetch quirk can break a recipe silently. Running the
  //   suite against all three engines catches that class of regression
  //   on the PR rather than after a Safari user files a "the page is
  //   blank" report.
  //
  // Mobile browsers (`Mobile Chrome`, `Mobile Safari`) are deliberately
  // out of scope: Vivarium's primary audience is desktop developers
  // working at >=1024 px viewports, and the mobile WASM cold-load
  // budget is materially harsher than the desktop one. Re-evaluate if
  // an actual mobile reproduction surface lands.
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
