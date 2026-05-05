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

import { loadVivariumPhp } from "../_shared/php_loader.js";
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

const startedAt = new Date();

try {
  const { php, phpWasmVersion } = await loadVivariumPhp({
    pendingText: "Loading php-wasm runtime and stdlib…",
  });

  setVerdict("pending", "Running reproduction script…");
  const { exitCode, stdout } = await php.run(REPRO_CODE);
  if (exitCode !== 0) {
    throw new Error(
      `php-wasm exited non-zero (code=${exitCode}); stdout=${stdout}`,
    );
  }
  const result = JSON.parse(stdout) as ReproOutput;

  metaEl.textContent =
    `PHP ${result.php_version} via php-wasm v${phpWasmVersion}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  // Bug reproduces iff xpath finds the PI node (count === 1) but
  // string-casting it yields an empty string.
  const reproduced = result.xpath_count === 1 && result.pi_text_empty;

  if (reproduced) {
    setVerdict(
      "reproduced",
      "bug reproduced — SimpleXML xpath returns the processing-instruction node, but casting it to string yields an empty value.",
    );
  } else if (
    result.xpath_count === 1 &&
    !result.pi_text_empty &&
    result.pi_text !== null
  ) {
    setVerdict(
      "unreproduced",
      "bug not reproduced — SimpleXML now returns the PI content correctly (likely fixed upstream).",
    );
  } else {
    setVerdict(
      "unreproduced",
      `bug not reproduced — unexpected outcome (xpath_count=${result.xpath_count}, pi_text=${JSON.stringify(result.pi_text)}).`,
    );
  }

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
        php: result.php_version,
      },
    },
    result: {
      xpath_count: result.xpath_count,
      pi_text: result.pi_text,
      pi_text_empty: result.pi_text_empty,
      reproduced,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);
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
