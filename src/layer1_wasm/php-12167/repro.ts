// Vivarium Layer 1 reproduction — php/php-src#12167.
//
// `SimpleXMLElement::xpath('//processing-instruction()')` returns a
// node, but casting that node to string yields an empty value instead
// of the PI's content:
//   $xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
//   $sxe = simplexml_load_string($xml);
//   $pi  = $sxe->xpath("//processing-instruction()")[0];
//   (string) $pi;   // => ""    (BUG, expected "hello")
// xpath finds the node — `count($pis) === 1` — so the issue is purely
// in the SimpleXML string-cast path for processing-instruction nodes.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — the bug REPRODUCES (PI string cast is empty).
//   - "unreproduced" — the bug does NOT reproduce (the runtime ships a fix,
//     or the runtime errored before producing a result).
//
// Phase 7 B3 (ADR-0030) — this recipe is the PoC for R.2 Path A
// (Layer 1 source-substitution branch-fix). After the baseline run
// captures the original verdict, we opt into the shared Path A panel
// so visitors can paste an alternative reproduction script (typically a
// userland fix proposed by an AI agent) and re-run it through the same
// php-wasm runtime. The panel produces a Contract v1 verdict bundle
// the visitor drops on /repro/compare for side-by-side review.

import { enablePathA, type PathACapturedRun } from "../_shared/path_a.js";
import { loadVivariumPhp, type PhpRunner } from "../_shared/php_loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

const REPRO_CODE = `<?php
$xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
$sxe = simplexml_load_string($xml);
$pis = $sxe->xpath("//processing-instruction()");
$pi_text = isset($pis[0]) ? (string) $pis[0] : null;

echo json_encode([
  "php_version" => PHP_VERSION,
  "xpath_count" => count($pis ?: []),
  "pi_text" => $pi_text,
  "pi_text_empty" => $pi_text === "",
]);
`;

interface ReproOutput {
  php_version: string;
  xpath_count: number;
  pi_text: string | null;
  pi_text_empty: boolean;
}

const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");
const pathAMountEl = document.getElementById("path-a-mount");

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "php-12167: missing required DOM elements (#output, #meta, #repro-code).",
  );
}

reproCodeEl.textContent = REPRO_CODE;
fetch("./repro.highlighted.html")
  .then((r) => (r.ok ? r.text() : null))
  .then((html) => {
    if (html) reproCodeEl.innerHTML = html;
  })
  .catch(() => {});

function evaluate(result: ReproOutput): {
  verdict: "reproduced" | "unreproduced";
  message: string;
} {
  // Bug reproduces iff xpath finds the PI node (count === 1) but
  // string-casting it yields an empty string.
  const reproduced = result.xpath_count === 1 && result.pi_text_empty;
  if (reproduced) {
    return {
      verdict: "reproduced",
      message:
        "bug reproduced — SimpleXML xpath returns the processing-instruction node, but casting it to string yields an empty value.",
    };
  }
  if (
    result.xpath_count === 1 &&
    !result.pi_text_empty &&
    result.pi_text !== null
  ) {
    return {
      verdict: "unreproduced",
      message:
        "bug not reproduced — SimpleXML now returns the PI content correctly (likely fixed upstream).",
    };
  }
  return {
    verdict: "unreproduced",
    message: `bug not reproduced — unexpected outcome (xpath_count=${result.xpath_count}, pi_text=${JSON.stringify(result.pi_text)}).`,
  };
}

async function captureRun(
  php: PhpRunner,
  source: string,
): Promise<PathACapturedRun> {
  const { exitCode, stdout } = await php.run(source);
  if (exitCode !== 0) {
    return {
      exitCode,
      verdict: "unreproduced",
      message: `php-wasm exited non-zero (code=${exitCode}); stdout=${stdout}`,
      stdout,
    };
  }
  let parsed: ReproOutput;
  try {
    parsed = JSON.parse(stdout) as ReproOutput;
  } catch (err: unknown) {
    return {
      exitCode,
      verdict: "unreproduced",
      message: `bug not reproduced — fix output was not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      stdout,
    };
  }
  const ev = evaluate(parsed);
  return {
    exitCode,
    verdict: ev.verdict,
    message: ev.message,
    stdout: JSON.stringify(parsed, null, 2),
  };
}

const startedAt = new Date();

try {
  const { php, phpWasmVersion } = await loadVivariumPhp({
    pendingText: "Loading php-wasm runtime and stdlib…",
  });

  setVerdict("pending", "Running reproduction script…");
  const baseline = await captureRun(php, REPRO_CODE);

  let baselineResult: ReproOutput;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    throw new Error(
      `php-12167: baseline run produced unparseable stdout: ${baseline.stdout}`,
    );
  }

  metaEl.textContent =
    `PHP ${baselineResult.php_version} via php-wasm v${phpWasmVersion}.`;
  outputEl.textContent = JSON.stringify(baselineResult, null, 2);

  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "php",
      issue: 12167,
      upstream_url: "https://github.com/php/php-src/issues/12167",
    },
    runtime: {
      name: "php-wasm",
      version: phpWasmVersion,
      extras: {
        php: baselineResult.php_version,
      },
    },
    result: {
      xpath_count: baselineResult.xpath_count,
      pi_text: baselineResult.pi_text,
      pi_text_empty: baselineResult.pi_text_empty,
      reproduced: baseline.verdict === "reproduced",
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  // Phase 7 B3 — opt into Path A. The mount-point lives in the page
  // markup (`<section id="path-a-mount" hidden>`); reveal it before
  // mounting so the panel transitions from hidden to populated atomically.
  if (pathAMountEl) {
    pathAMountEl.removeAttribute("hidden");
    void enablePathA({
      slug: "php-12167",
      baselineSource: REPRO_CODE,
      baseline,
      runFix: (source) => captureRun(php, source),
    });
  }
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
