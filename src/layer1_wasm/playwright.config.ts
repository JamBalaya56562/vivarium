// Playwright configuration for the reproduction-regression suite.
//
// What this suite asserts (per ADR-0008 / ADR-0010 notes):
// - Every reproduction page (Layer 1 *and* Layer 2) declares
//   `<meta name="vivarium-contract" content="v1">`.
// - The DOM verdict, the `__VIVARIUM_VERDICT__` global, and the
//   `__VIVARIUM_RESULT__` envelope all reach the documented
//   verdict state.
// - The smoke test under `_shared/_test/` reaches `pass` without
//   loading any WASM runtime.
//
// Two static HTTP servers are auto-started: one for Layer 1
// (port 8767, serves `src/layer1_wasm/`) and one for Layer 2
// (port 8768, serves `src/layer2_docker/`). Test cases address
// pages via absolute URLs so a single suite covers both layers
// without juggling baseURL or projects.
//
// The suite is intentionally serial: Pyodide instances are heavy
// (hundreds of MB resident) and parallel runs OOM on standard CI
// runners. Layer 2 pages are fast (just fetch verdict.json) but
// run in the same worker for simplicity.

import { defineConfig, devices } from "@playwright/test";

export const LAYER1_PORT = 8767;
export const LAYER2_PORT = 8768;
export const LAYER1_BASE = `http://localhost:${LAYER1_PORT}`;
export const LAYER2_BASE = `http://localhost:${LAYER2_PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,

  // Retry once in CI to absorb transient CDN flakes (jsDelivr fetch
  // failures, Pyodide cold-start jitter). Locally retries hide bugs;
  // run them once and fix.
  retries: process.env["CI"] ? 1 : 0,

  // Per-test timeout. Pyodide cold-load + pandas wheel can sit in the
  // 25-30 s range on CI runners; double that for headroom.
  timeout: 90_000,

  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    // No global baseURL — each case decides its own host (Layer 1 vs
    // Layer 2) by passing an absolute URL into `page.goto`.
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    // Capture trace + screenshot only on failure; keeps successful runs
    // cheap.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Auto-start two static servers — one per layer root. Both run from
  // the test config's working directory (`src/layer1_wasm/` when
  // `bun run test` is invoked there); we use `cwd` to point each
  // server at its layer.
  webServer: [
    {
      // UV provides Python on demand (mise no longer installs Python).
      command: `uv run --no-project --python 3.13 python -m http.server ${LAYER1_PORT}`,
      url: `${LAYER1_BASE}/`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `uv run --no-project --python 3.13 python -m http.server ${LAYER2_PORT}`,
      cwd: "../layer2_docker",
      url: `${LAYER2_BASE}/`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
