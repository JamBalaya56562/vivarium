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
  name: string;
  url: string;
  expectedVerdict: ExpectedVerdict;
  expectedBugProject: string;
  expectedBugIssue: number;
  expectedRuntimeName: ExpectedRuntimeName;
  expectsFixPane: boolean;
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
    import.meta.dirname,
    "../../..",
    "docs/site/public/api/recipes.json",
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
    expectsFixPane: recipe.layer === 1,
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
    expectsFixPane: false,
  };
  const recipes = loadRecipeEntries()
    .filter((recipe) => recipe.layer === 1 || recipe.layer === 2)
    .map(caseFromRecipe);
  return [smoke, ...recipes];
}

const cases: ReproCase[] = loadRegressionCases();

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
  if (name === "browser" || name === "docker-snapshot") return 10_000;
  if (name === "pyodide") return 120_000;
  return 75_000;
}

for (const c of cases) {
  test(`${c.name} produces ${c.expectedVerdict}`, async ({ page }) => {
    test.setTimeout(timeoutForRuntime(c.expectedRuntimeName) + 15_000);

    await page.goto(c.url);

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

    const domVerdict = await page
      .locator("#verdict")
      .getAttribute("data-verdict");
    expect.soft(domVerdict, "#verdict[data-verdict]").toBe(c.expectedVerdict);

    const contractMeta = await page
      .locator('meta[name="vivarium-contract"]')
      .getAttribute("content");
    expect.soft(contractMeta, "<meta vivarium-contract>").toBe("v1");

    expect
      .soft(state.runtimeName, "envelope runtime.name")
      .toBe(c.expectedRuntimeName);

    if (c.expectsFixPane) {
      const fixPane = page.locator("#output-fix");
      await expect.soft(fixPane, "#output-fix exists").toHaveCount(1);

      await expect
        .soft(fixPane, "#output-fix settled (not left pending)")
        .not.toHaveAttribute("data-fix-status", "pending", {
          timeout: 60_000,
        });

      const fixText = ((await fixPane.textContent()) ?? "").trim();
      expect
        .soft(fixText.length, "#output-fix is non-empty")
        .toBeGreaterThan(0);
    }
  });
}
