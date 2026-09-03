import { defineConfig, devices } from "@playwright/test";

export const LAYER1_PORT = 8767;
export const LAYER2_PORT = 8768;
export const LAYER1_BASE = `http://localhost:${LAYER1_PORT}`;
export const LAYER2_BASE = `http://localhost:${LAYER2_PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,

  retries: process.env["CI"] ? 1 : 0,

  timeout: 90_000,

  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: [
    {
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
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
