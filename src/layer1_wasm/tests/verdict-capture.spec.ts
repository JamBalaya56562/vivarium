// Verdict-capture spec for Phase 3 of the round-trip automation:
// runs one Layer 1 recipe in the existing Playwright harness, waits
// for the in-page contract-v1 verdict, and writes a JSON snapshot to
// the path in `VERDICT_CAPTURE_OUTPUT` so the MCP server's
// `run_layer1_verdict` helper can read it back. Driven by `--grep
// "verdict-capture: <slug>"` so the helper can target a single recipe.
//
// Optional env vars:
//   PLAYWRIGHT_FIX_URL       — appended as ?fix_url=<value> on the
//                              recipe URL so the recipe page substitutes
//                              the candidate fix before producing a
//                              verdict (Path A semantics).
//   VERDICT_CAPTURE_OUTPUT   — absolute path where the captured verdict
//                              is written as JSON. If unset, the spec
//                              just asserts the verdict reached one of
//                              the contract-v1 values without writing.
//
// Recipe list is sourced from docs/site/public/api/recipes.json so a
// new Layer 1 recipe automatically gets a verdict-capture case once
// `mise run recipes:index` is run.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const LAYER1 = "http://localhost:8767";

interface RecipeEntry {
  slug: string;
  layer: 1 | 2 | 3;
}

interface RecipesIndex {
  recipes: RecipeEntry[];
}

function loadLayer1Slugs(): string[] {
  const indexPath = resolve(
    process.cwd(),
    "../../docs/site/public/api/recipes.json",
  );
  const raw = readFileSync(indexPath, "utf-8");
  const parsed = JSON.parse(raw) as RecipesIndex;
  return parsed.recipes
    .filter((r) => r.layer === 1)
    .map((r) => r.slug)
    .sort();
}

const SLUGS = loadLayer1Slugs();
const FIX_URL = process.env["PLAYWRIGHT_FIX_URL"];
const OUTPUT_PATH = process.env["VERDICT_CAPTURE_OUTPUT"];

for (const slug of SLUGS) {
  test(`verdict-capture: ${slug}`, async ({ page }) => {
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
      { timeout: 75_000 },
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
