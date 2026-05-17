// Regression suite for the reproduction gallery (Layer 1 + Layer 2).
//
// Each case asserts that a page reaches its expected verdict on the
// runtime it loads, and that the vivarium contract v1 surface
// (`#verdict[data-verdict]`, `__VIVARIUM_VERDICT__`,
// `__VIVARIUM_RESULT__`, `<meta name="vivarium-contract">`) is
// published correctly. The contract is single-sourced at
// https://aletheia-works.github.io/vivarium/spec/contract-v1
// (markdown: `docs/site/en/spec/contract-v1.md`).
//
// Layer 1 cases hit the WASM-runtime server on port 8767 (config
// `LAYER1_PORT`). Layer 2 cases hit the Docker-recipe-snapshot server
// on port 8768 (config `LAYER2_PORT`); their verdict comes from
// `verdict.json` captured by CI rather than from a live in-page run,
// so the same envelope shape covers both layers.
//
// When the verdict a page produces flips from `reproduced` to
// `unreproduced`, that is a real signal: either the upstream project
// merged a fix and the runtime picked it up, or the runtime regressed.
// Either way, this suite turns that into a CI failure so a human can
// decide whether to update / retire the page.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const LAYER1 = "http://localhost:8767";
const LAYER2 = "http://localhost:8768";

const SUPPORTED_VERDICTS = ["reproduced", "unreproduced"] as const;
const SUPPORTED_RUNTIMES = [
  "browser",
  "pyodide",
  "ruby.wasm",
  "php-wasm",
  "rust-wasi",
  "docker-snapshot",
] as const;

type ExpectedVerdict = (typeof SUPPORTED_VERDICTS)[number];
type ExpectedRuntimeName = (typeof SUPPORTED_RUNTIMES)[number];

interface ReproCase {
  /** Display name used in the test title. */
  name: string;
  /** Absolute URL — pick the Layer 1 or Layer 2 host as appropriate. */
  url: string;
  /** Expected verdict — currently "reproduced" for every case. */
  expectedVerdict: ExpectedVerdict;
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
  expectedRuntimeName: ExpectedRuntimeName;
}

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
  project: string;
  issue: number;
  expected_verdict?: string;
  expected_runtime?: string;
}

interface RecipesIndex {
  recipes: RecipeEntry[];
}

function isExpectedVerdict(value: unknown): value is ExpectedVerdict {
  return SUPPORTED_VERDICTS.some((v) => v === value);
}

function isExpectedRuntimeName(value: unknown): value is ExpectedRuntimeName {
  return SUPPORTED_RUNTIMES.some((v) => v === value);
}

function loadRecipeEntries(): RecipeEntry[] {
  const indexPath = resolve(
    process.cwd(),
    "../../docs/site/public/api/recipes.json",
  );
  const raw = readFileSync(indexPath, "utf-8");
  const parsed = JSON.parse(raw) as RecipesIndex;
  return parsed.recipes;
}

function recipeCaseName(recipe: RecipeEntry): string {
  if (recipe.layer === 1) return `${recipe.slug} reproduction`;
  return `${recipe.slug} Layer 2 snapshot`;
}

function recipeUrl(recipe: RecipeEntry): string {
  const base = recipe.layer === 1 ? LAYER1 : LAYER2;
  return `${base}/${recipe.slug}/`;
}

function caseFromRecipe(recipe: RecipeEntry): ReproCase {
  if (!isExpectedVerdict(recipe.expected_verdict)) {
    throw new Error(
      `${recipe.slug}: expected_verdict must be one of ${SUPPORTED_VERDICTS.join(", ")}`,
    );
  }
  if (!isExpectedRuntimeName(recipe.expected_runtime)) {
    throw new Error(
      `${recipe.slug}: expected_runtime must be one of ${SUPPORTED_RUNTIMES.join(", ")}`,
    );
  }
  return {
    name: recipeCaseName(recipe),
    url: recipeUrl(recipe),
    expectedVerdict: recipe.expected_verdict,
    expectedBugProject: recipe.project,
    expectedBugIssue: recipe.issue,
    expectedRuntimeName: recipe.expected_runtime,
  };
}

function loadRegressionCases(): ReproCase[] {
  const smoke: ReproCase = {
    name: "_shared/_test smoke test",
    url: `${LAYER1}/_shared/_test/`,
    expectedVerdict: "reproduced",
    expectedBugProject: "vivarium",
    expectedBugIssue: 0,
    expectedRuntimeName: "browser",
  };
  const recipes = loadRecipeEntries()
    .filter((recipe) => recipe.layer === 1 || recipe.layer === 2)
    .map(caseFromRecipe);
  return [smoke, ...recipes];
}

const cases: ReproCase[] = loadRegressionCases();

// Layer 1 — WASM in-page runtime. Layer 2 — Docker catalogue, verdict
// snapshot fetched from `verdict.json` next to the page. CI generates
// `verdict.json` in both `repro-regression.yml` (build + run + write)
// and `deploy-docs.yml` (build + push + write); locally Playwright sees
// the regression-flow output.

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
  // Pyodide pages download and import large wheels, with SymPy on
  // Firefox sitting near the old 75s ceiling on cold local runs.
  if (name === "browser" || name === "docker-snapshot") return 10_000;
  if (name === "pyodide") return 120_000;
  return 75_000;
}

for (const c of cases) {
  test(`${c.name} produces ${c.expectedVerdict}`, async ({ page }) => {
    test.setTimeout(timeoutForRuntime(c.expectedRuntimeName) + 15_000);

    await page.goto(c.url);

    // Wait for the verdict to settle. Pages start at `pending` and
    // transition to `reproduced` or `unreproduced` once the reproduction
    // (or the verdict-snapshot fetch) completes.
    await page.waitForFunction(
      () => {
        const v = (
          globalThis as unknown as { __VIVARIUM_VERDICT__?: string }
        ).__VIVARIUM_VERDICT__;
        return v === "reproduced" || v === "unreproduced";
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
