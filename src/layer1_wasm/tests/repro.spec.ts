// Regression suite for the Layer 1 reproduction gallery.
//
// Each case asserts that a page in `src/layer1_wasm/` reaches its
// expected verdict on the bundled Pyodide runtime, and that the
// vivarium contract v1 surface (`#verdict[data-verdict]`,
// `__VIVARIUM_VERDICT__`, `__VIVARIUM_RESULT__`,
// `<meta name="vivarium-contract">`) is published correctly.
//
// When the verdict an upstream-bug page produces flips from `pass`
// to `fail`, that is a real signal: either the upstream project
// merged a fix and Pyodide picked it up, or the runtime regressed.
// Either way, this suite turns that into a CI failure so a human
// can decide whether to update / retire the page or file an
// upstream-fix-detection Issue.

import { expect, test, type Page } from "@playwright/test";

interface ReproCase {
  /** Display name used in the test title. */
  name: string;
  /** URL path served by Playwright's webServer (relative to baseURL). */
  path: string;
  /** Expected verdict — currently "pass" for every case (reproduces). */
  expectedVerdict: "pass" | "fail";
  /** Envelope `bug.project` field. */
  expectedBugProject: string;
  /** Envelope `bug.issue` field. */
  expectedBugIssue: number;
  /**
   * `true` for pages that load Pyodide; the verdict can take 30+ s.
   * `false` for the smoke test, which validates plumbing only and
   * resolves in well under a second.
   */
  loadsPyodide: boolean;
}

const cases: ReproCase[] = [
  {
    name: "_shared/_test smoke test",
    path: "/_shared/_test/",
    expectedVerdict: "pass",
    expectedBugProject: "vivarium",
    expectedBugIssue: 0,
    loadsPyodide: false,
  },
  {
    name: "pandas-56679 reproduction",
    path: "/pandas-56679/",
    expectedVerdict: "pass",
    expectedBugProject: "pandas",
    expectedBugIssue: 56679,
    loadsPyodide: true,
  },
  {
    name: "numpy-28287 reproduction",
    path: "/numpy-28287/",
    expectedVerdict: "pass",
    expectedBugProject: "numpy",
    expectedBugIssue: 28287,
    loadsPyodide: true,
  },
  {
    name: "cpython-137205 reproduction",
    path: "/cpython-137205/",
    expectedVerdict: "pass",
    expectedBugProject: "cpython",
    expectedBugIssue: 137205,
    loadsPyodide: true,
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

for (const c of cases) {
  test(`${c.name} produces ${c.expectedVerdict}`, async ({ page }) => {
    await page.goto(c.path);

    // Wait for the verdict to settle. Pages start at `pending` and
    // transition to `pass` or `fail` once the reproduction (or the
    // smoke-test plumbing) completes.
    await page.waitForFunction(
      () => {
        const v = (
          globalThis as unknown as { __VIVARIUM_VERDICT__?: string }
        ).__VIVARIUM_VERDICT__;
        return v === "pass" || v === "fail";
      },
      undefined,
      { timeout: c.loadsPyodide ? 75_000 : 10_000 },
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

    // Pyodide-loading pages should report a pyodide runtime; the smoke
    // test should not (it explicitly skips the runtime).
    if (c.loadsPyodide) {
      expect
        .soft(state.runtimeName, "envelope runtime.name")
        .toBe("pyodide");
    } else {
      expect
        .soft(state.runtimeName, "envelope runtime.name (smoke)")
        .not.toBe("pyodide");
    }
  });
}
