// Phase 7 B3 — R.2 Path A regression suite.
//
// Asserts the Path A panel on the php-12167 PoC recipe:
//  - Mounts after the baseline run completes.
//  - Accepts a userland fix via the textarea + Run button and re-runs
//    the substituted source through the same php-wasm runtime.
//  - Captures a Contract v1 verdict bundle reflecting the substituted
//    source's outcome.
//  - Auto-triggers from `?fix=` (base64url) URL params.
//
// The Path A bundle is what /repro/compare consumes; this suite locks
// the wire shape without depending on the docs site being up.

import { expect, test, type Page } from "@playwright/test";

const LAYER1 = "http://localhost:8767";
const PHP_RECIPE = `${LAYER1}/php-12167/`;

// A userland fix that sidesteps the SimpleXML PI string-cast bug by
// parsing the PI content out of asXML() instead of casting the node
// to string. With this fix, `pi_text` becomes "hello" and the recipe
// page evaluates the run as `unreproduced`.
const SIDESTEP_FIX = `<?php
$xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
$sxe = simplexml_load_string($xml);
$pis = $sxe->xpath("//processing-instruction()");

$pi_text = null;
if (isset($pis[0])) {
  $pi_xml = $pis[0]->asXML();
  if (preg_match('#<\\?\\S+\\s+(.*?)\\s*\\?>#', $pi_xml, $m)) {
    $pi_text = $m[1];
  }
}

echo json_encode([
  "php_version" => PHP_VERSION,
  "xpath_count" => count($pis ?: []),
  "pi_text" => $pi_text,
  "pi_text_empty" => $pi_text === "",
]);
`;

// A "broken fix" — looks like a fix but still reproduces the bug. The
// userland workaround tries to cast through a no-op intermediate, but
// the bug is in (string) coercion of the PI node itself, so casting
// twice reproduces the same emptiness.
const BROKEN_FIX = `<?php
$xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
$sxe = simplexml_load_string($xml);
$pis = $sxe->xpath("//processing-instruction()");

$pi_text = isset($pis[0]) ? trim((string) $pis[0]) : null;

echo json_encode([
  "php_version" => PHP_VERSION,
  "xpath_count" => count($pis ?: []),
  "pi_text" => $pi_text,
  "pi_text_empty" => $pi_text === "",
]);
`;

async function waitForBaselineVerdict(page: Page): Promise<void> {
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
}

async function runPathA(page: Page, source: string): Promise<void> {
  // Wait for the panel to render — enablePathA awaits sha256Hex before
  // mounting.
  await page.waitForSelector(".vh-path-a__heading", { timeout: 15_000 });
  await page.fill(".vh-path-a__textarea", source);
  await page.click(".vh-path-a__btn--primary");
  // Wait for the second download row (branch) to appear.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".vh-path-a__download-row").length >= 2,
    undefined,
    { timeout: 60_000 },
  );
}

test("php-12167 Path A panel mounts after baseline run", async ({ page }) => {
  await page.goto(PHP_RECIPE);
  await waitForBaselineVerdict(page);

  // Mount-point becomes visible (panel removes `hidden`) and the panel
  // heading renders.
  const heading = page.locator(".vh-path-a__heading");
  await expect(heading).toBeVisible({ timeout: 15_000 });

  // Original-side download row is present from the start.
  const rows = page.locator(".vh-path-a__download-row");
  await expect(rows).toHaveCount(1);

  // Original verdict is `reproduced` (the bug fires by default).
  const originalVerdict = page.locator(
    ".vh-path-a__download-row .vh-path-a__verdict",
  );
  await expect(originalVerdict).toHaveText("reproduced");
});

test("php-12167 Path A — sidestep fix flips verdict to unreproduced", async ({
  page,
}) => {
  await page.goto(PHP_RECIPE);
  await waitForBaselineVerdict(page);
  await runPathA(page, SIDESTEP_FIX);

  // Two rows: original + branch. Original = reproduced, branch = unreproduced.
  const verdicts = page.locator(
    ".vh-path-a__download-row .vh-path-a__verdict",
  );
  await expect(verdicts).toHaveCount(2);
  await expect(verdicts.nth(0)).toHaveText("reproduced");
  await expect(verdicts.nth(1)).toHaveText("unreproduced");
});

test("php-12167 Path A — broken fix keeps verdict reproduced", async ({
  page,
}) => {
  await page.goto(PHP_RECIPE);
  await waitForBaselineVerdict(page);
  await runPathA(page, BROKEN_FIX);

  const verdicts = page.locator(
    ".vh-path-a__download-row .vh-path-a__verdict",
  );
  await expect(verdicts).toHaveCount(2);
  await expect(verdicts.nth(0)).toHaveText("reproduced");
  await expect(verdicts.nth(1)).toHaveText("reproduced");
});

test("php-12167 Path A — captured branch-fix verdict matches Contract v1 shape", async ({
  page,
}) => {
  await page.goto(PHP_RECIPE);
  await waitForBaselineVerdict(page);
  await runPathA(page, SIDESTEP_FIX);

  // Read the branch-fix verdict from the download link's blob URL.
  const branchHref = await page
    .locator(".vh-path-a__download-link")
    .nth(1)
    .getAttribute("href");
  expect(branchHref).toMatch(/^blob:/);

  const verdictJson = await page.evaluate(async (href: string) => {
    const res = await fetch(href);
    return res.text();
  }, branchHref!);

  const parsed = JSON.parse(verdictJson) as Record<string, unknown>;
  expect.soft(parsed["contract"], "contract").toBe("v1");
  expect.soft(parsed["verdict"], "verdict").toBe("unreproduced");
  expect.soft(parsed["exit_code"], "exit_code").toBe(0);
  expect
    .soft(parsed["image_tag"], "image_tag")
    .toMatch(/^layer1:php-12167:[0-9a-f]{12}$/);
  expect.soft(parsed["image_digest"], "image_digest").toBe("");
  expect.soft(parsed["stderr_tail"], "stderr_tail").toBe("");
  expect
    .soft(parsed["captured_at"], "captured_at")
    .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("php-12167 Path A — ?fix=<base64url> auto-triggers", async ({ page }) => {
  // base64url-encode the sidestep fix.
  const encoded = await page.evaluate((source: string) => {
    const bytes = new TextEncoder().encode(source);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }, SIDESTEP_FIX);

  await page.goto(`${PHP_RECIPE}?fix=${encoded}`);
  await waitForBaselineVerdict(page);

  // Wait for the branch row to populate via the URL-param auto-trigger.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".vh-path-a__download-row").length >= 2,
    undefined,
    { timeout: 60_000 },
  );

  const verdicts = page.locator(
    ".vh-path-a__download-row .vh-path-a__verdict",
  );
  await expect(verdicts.nth(1)).toHaveText("unreproduced");
});
