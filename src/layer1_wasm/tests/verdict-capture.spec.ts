import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const LAYER1 = "http://localhost:8767";

const SUPPORTED_RUNTIMES = [
  "browser",
  "pyodide",
  "ruby.wasm",
  "php-wasm",
  "rust-wasi",
] as const;

type ExpectedRuntimeName = (typeof SUPPORTED_RUNTIMES)[number];

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
  expected_runtime?: string;
}

interface RecipesIndex {
  recipes: RecipeEntry[];
}

interface Layer1Recipe {
  slug: string;
  expectedRuntimeName: ExpectedRuntimeName;
}

function isExpectedRuntimeName(value: unknown): value is ExpectedRuntimeName {
  return SUPPORTED_RUNTIMES.some((v) => v === value);
}

function loadLayer1Recipes(): Layer1Recipe[] {
  const indexPath = resolve(
    import.meta.dirname,
    "../../..",
    "docs/site/public/api/recipes.json",
  );
  const raw = readFileSync(indexPath, "utf-8");
  const parsed = JSON.parse(raw) as RecipesIndex;
  return parsed.recipes
    .filter((r) => r.layer === 1)
    .map((r) => {
      if (!isExpectedRuntimeName(r.expected_runtime)) {
        throw new Error(
          `${r.slug}: expected_runtime must be one of ${SUPPORTED_RUNTIMES.join(", ")}`,
        );
      }
      return { slug: r.slug, expectedRuntimeName: r.expected_runtime };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function timeoutForRuntime(name: ExpectedRuntimeName): number {
  if (name === "browser") return 10_000;
  if (name === "pyodide") return 120_000;
  return 75_000;
}

const RECIPES = loadLayer1Recipes();
const FIX_URL = process.env["PLAYWRIGHT_FIX_URL"];
const OUTPUT_PATH = process.env["VERDICT_CAPTURE_OUTPUT"];

for (const { slug, expectedRuntimeName } of RECIPES) {
  test(`verdict-capture: ${slug}`, async ({ page }) => {
    test.setTimeout(timeoutForRuntime(expectedRuntimeName) + 15_000);

    let url = `${LAYER1}/${slug}/`;
    if (FIX_URL) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}fix_url=${encodeURIComponent(FIX_URL)}`;
    }
    await page.goto(url);

    await page.waitForFunction(
      () => {
        const v = (
          globalThis as unknown as { __VIVARIUM_VERDICT__?: string }
        ).__VIVARIUM_VERDICT__;
        return v === "reproduced" || v === "unreproduced";
      },
      undefined,
      { timeout: timeoutForRuntime(expectedRuntimeName) },
    );

    const verdict = await page.evaluate(
      () =>
        (globalThis as unknown as { __VIVARIUM_VERDICT__: string })
          .__VIVARIUM_VERDICT__,
    );

    if (OUTPUT_PATH) {
      writeFileSync(
        OUTPUT_PATH,
        `${JSON.stringify({
          slug,
          verdict,
          fix_url: FIX_URL ?? null,
          captured_at: new Date().toISOString(),
        })}\n`,
        "utf-8",
      );
    }

    expect(["reproduced", "unreproduced"]).toContain(verdict);
  });
}
