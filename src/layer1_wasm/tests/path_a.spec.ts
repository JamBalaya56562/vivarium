import { expect, test, type Page } from "@playwright/test";

const LAYER1 = "http://localhost:8767";
const PHP_RECIPE = `${LAYER1}/php-12167/`;

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
  await page.waitForSelector(".vh-path-a__heading", { timeout: 15_000 });
  await page.fill(".vh-path-a__textarea", source);
  await page.click(".vh-path-a__btn--primary");
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

  const heading = page.locator(".vh-path-a__heading");
  await expect(heading).toBeVisible({ timeout: 15_000 });

  const rows = page.locator(".vh-path-a__download-row");
  await expect(rows).toHaveCount(1);

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
