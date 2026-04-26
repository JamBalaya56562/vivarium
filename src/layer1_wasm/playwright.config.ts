// Playwright configuration for the Layer 1 reproduction-regression suite.
//
// What this suite asserts (per the maintainer-private ADR-0008 notes):
// - Every reproduction page declares `<meta name="vivarium-contract"
//   content="v1">`.
// - The DOM verdict, the `__VIVARIUM_VERDICT__` global, and the
//   `__VIVARIUM_RESULT__` envelope all reach a `pass` state on the
//   bundled Pyodide runtime, matching what the page documents.
// - The smoke test under `_shared/_test/` reaches `pass` without
//   loading Pyodide.
//
// The suite is intentionally serial: Pyodide instances are heavy
// (hundreds of MB resident) and parallel runs OOM on standard CI
// runners. With 2-3 cases the wall-clock cost is ~30-60 s, well
// inside the workflow's 15-minute budget.

import { defineConfig, devices } from "@playwright/test";

const PORT = 8767;

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
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    // Capture trace + screenshot only on failure; keeps successful runs
    // cheap.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  // Auto-start a static HTTP server on the layer1 root so test cases
  // can hit `/_shared/_test/`, `/pandas-56679/`, `/numpy-28287/`. The
  // server is reused across test runs locally; CI starts a fresh one
  // each job.
  webServer: {
    command: `python -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
