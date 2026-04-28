// Regression suite for the reproduction gallery (Layer 1 + Layer 2).
//
// Each case asserts that a page reaches its expected verdict on the
// runtime it loads, and that the vivarium contract v1 surface
// (`#verdict[data-verdict]`, `__VIVARIUM_VERDICT__`,
// `__VIVARIUM_RESULT__`, `<meta name="vivarium-contract">`) is
// published correctly. The contract is single-sourced at
// https://aletheia-works.github.io/vivarium/spec/contract-v1
// (markdown: `docs/docs/spec/contract-v1.md`).
//
// Layer 1 cases hit the WASM-runtime server on port 8767 (config
// `LAYER1_PORT`). Layer 2 cases hit the Docker-recipe-snapshot server
// on port 8768 (config `LAYER2_PORT`); their verdict comes from
// `verdict.json` captured by CI rather than from a live in-page run,
// so the same envelope shape covers both layers.
//
// When the verdict a page produces flips from `pass` to `fail`, that
// is a real signal: either the upstream project merged a fix and the
// runtime picked it up, or the runtime regressed. Either way, this
// suite turns that into a CI failure so a human can decide whether
// to update / retire the page.

import { expect, test, type Page } from "@playwright/test";

const LAYER1 = "http://localhost:8767";
const LAYER2 = "http://localhost:8768";

interface ReproCase {
  /** Display name used in the test title. */
  name: string;
  /** Absolute URL — pick the Layer 1 or Layer 2 host as appropriate. */
  url: string;
  /** Expected verdict — currently "pass" for every case (reproduces). */
  expectedVerdict: "pass" | "fail";
  /** Envelope `bug.project` field. */
  expectedBugProject: string;
  /** Envelope `bug.issue` field. */
  expectedBugIssue: number;
  /**
   * Envelope `runtime.name`. `"browser"` for the smoke test (no WASM
   * runtime loaded); language runtimes bootstrapped over WebAssembly
   * for Layer 1 pages; `"docker-snapshot"` for Layer 2 pages
   * rendering a CI-captured verdict.
   */
  expectedRuntimeName:
    | "browser"
    | "pyodide"
    | "ruby.wasm"
    | "php-wasm"
    | "rust-wasi"
    | "docker-snapshot";
}

const cases: ReproCase[] = [
  // Layer 1 — WASM in-page runtime.
  {
    name: "_shared/_test smoke test",
    url: `${LAYER1}/_shared/_test/`,
    expectedVerdict: "pass",
    expectedBugProject: "vivarium",
    expectedBugIssue: 0,
    expectedRuntimeName: "browser",
  },
  {
    name: "pandas-56679 reproduction",
    url: `${LAYER1}/pandas-56679/`,
    expectedVerdict: "pass",
    expectedBugProject: "pandas",
    expectedBugIssue: 56679,
    expectedRuntimeName: "pyodide",
  },
  {
    name: "numpy-28287 reproduction",
    url: `${LAYER1}/numpy-28287/`,
    expectedVerdict: "pass",
    expectedBugProject: "numpy",
    expectedBugIssue: 28287,
    expectedRuntimeName: "pyodide",
  },
  {
    name: "ruby-21709 reproduction",
    url: `${LAYER1}/ruby-21709/`,
    expectedVerdict: "pass",
    expectedBugProject: "ruby",
    expectedBugIssue: 21709,
    expectedRuntimeName: "ruby.wasm",
  },
  {
    name: "cpython-137205 reproduction",
    url: `${LAYER1}/cpython-137205/`,
    expectedVerdict: "pass",
    expectedBugProject: "cpython",
    expectedBugIssue: 137205,
    expectedRuntimeName: "pyodide",
  },
  {
    name: "php-12167 reproduction",
    url: `${LAYER1}/php-12167/`,
    expectedVerdict: "pass",
    expectedBugProject: "php",
    expectedBugIssue: 12167,
    expectedRuntimeName: "php-wasm",
  },
  {
    name: "regex-779 reproduction",
    url: `${LAYER1}/regex-779/`,
    expectedVerdict: "pass",
    expectedBugProject: "regex",
    expectedBugIssue: 779,
    expectedRuntimeName: "rust-wasi",
  },
  // Layer 2 — Docker catalogue, verdict snapshot fetched from
  // `verdict.json` next to the page. CI generates `verdict.json` in
  // both `repro-regression.yml` (build + run + write) and
  // `deploy-docs.yml` (build + push + write); locally Playwright sees
  // the regression-flow output. All three current entries are
  // expected `pass` snapshots.
  {
    name: "postgres-lost-update Layer 2 snapshot",
    url: `${LAYER2}/postgres-lost-update/`,
    expectedVerdict: "pass",
    expectedBugProject: "postgres",
    expectedBugIssue: 0,
    expectedRuntimeName: "docker-snapshot",
  },
  {
    name: "bash-local-shadows-exit Layer 2 snapshot",
    url: `${LAYER2}/bash-local-shadows-exit/`,
    expectedVerdict: "pass",
    expectedBugProject: "bash",
    expectedBugIssue: 0,
    expectedRuntimeName: "docker-snapshot",
  },
  {
    name: "flock-is-advisory Layer 2 snapshot",
    url: `${LAYER2}/flock-is-advisory/`,
    expectedVerdict: "pass",
    expectedBugProject: "flock",
    expectedBugIssue: 0,
    expectedRuntimeName: "docker-snapshot",
  },
  {
    name: "find-xargs-whitespace Layer 2 snapshot",
    url: `${LAYER2}/find-xargs-whitespace/`,
    expectedVerdict: "pass",
    expectedBugProject: "find-xargs",
    expectedBugIssue: 0,
    expectedRuntimeName: "docker-snapshot",
  },
];

interface VivariumPageState {
  verdict: string | undefined;
  contract: string | undefined;
  bugProject: string | undefined;
  bugIssue: number | undefined;
  runtimeName: string | undefined;
}

async function readVivariumState(page: Page): Promise<VivariumPageState> {
  return page.evaluate(() => {
    interface VivariumGlobals {
      __VIVARIUM_VERDICT__?: string;
      __VIVARIUM_RESULT__?: {
        contract?: string;
        bug?: { project?: string; issue?: number };
        runtime?: { name?: string };
      };
    }
    const g = globalThis as unknown as VivariumGlobals;
    return {
      verdict: g.__VIVARIUM_VERDICT__,
      contract: g.__VIVARIUM_RESULT__?.contract,
      bugProject: g.__VIVARIUM_RESULT__?.bug?.project,
      bugIssue: g.__VIVARIUM_RESULT__?.bug?.issue,
      runtimeName: g.__VIVARIUM_RESULT__?.runtime?.name,
    };
  });
}

function timeoutForRuntime(name: ReproCase["expectedRuntimeName"]): number {
  // Smoke test and Layer 2 verdict-snapshot fetch resolve in milliseconds;
  // WASM-runtime pages download a multi-MB CDN bundle and instantiate it.
  if (name === "browser" || name === "docker-snapshot") return 10_000;
  return 75_000;
}

for (const c of cases) {
  test(`${c.name} produces ${c.expectedVerdict}`, async ({ page }) => {
    await page.goto(c.url);

    // Wait for the verdict to settle. Pages start at `pending` and
    // transition to `pass` or `fail` once the reproduction (or the
    // verdict-snapshot fetch) completes.
    await page.waitForFunction(
      () => {
        const v = (
          globalThis as unknown as { __VIVARIUM_VERDICT__?: string }
        ).__VIVARIUM_VERDICT__;
        return v === "pass" || v === "fail";
      },
      undefined,
      { timeout: timeoutForRuntime(c.expectedRuntimeName) },
    );

    const state = await readVivariumState(page);

    expect.soft(state.verdict, "DOM/global verdict").toBe(c.expectedVerdict);
    expect.soft(state.contract, "envelope contract").toBe("v1");
    expect
      .soft(state.bugProject, "envelope bug.project")
      .toBe(c.expectedBugProject);
    expect
      .soft(state.bugIssue, "envelope bug.issue")
      .toBe(c.expectedBugIssue);

    // Cross-check the DOM `data-verdict` attribute matches the global —
    // they are written together by `setVerdict`, and a divergence would
    // indicate the helpers got out of sync.
    const domVerdict = await page
      .locator("#verdict")
      .getAttribute("data-verdict");
    expect.soft(domVerdict, "#verdict[data-verdict]").toBe(c.expectedVerdict);

    // Sanity: the page declares the contract version via meta tag.
    const contractMeta = await page
      .locator('meta[name="vivarium-contract"]')
      .getAttribute("content");
    expect.soft(contractMeta, "<meta vivarium-contract>").toBe("v1");

    expect
      .soft(state.runtimeName, "envelope runtime.name")
      .toBe(c.expectedRuntimeName);
  });
}
