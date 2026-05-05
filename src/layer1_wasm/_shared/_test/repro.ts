// Smoke test for `_shared/verdict.ts`.
//
// Validates that the helpers wire up the contract-v1 surface:
// - DOM `#verdict[data-verdict]`
// - `globalThis.__VIVARIUM_VERDICT__`
// - `globalThis.__VIVARIUM_RESULT__` envelope
//
// Pyodide is intentionally NOT loaded here — the goal is to verify the
// helper plumbing in isolation. Reproduction-level smoke tests live in
// each per-bug page.

import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../verdict.js";

const startedAt = new Date();
const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");

if (!outputEl || !metaEl) {
  throw new Error(
    "smoke test: missing required elements (#output, #meta) in HTML.",
  );
}

try {
  setVerdict("reproduced", "bug reproduced — _shared helpers wired up.");

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "vivarium",
      issue: 0,
      upstream_url:
        "https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm/_shared",
    },
    runtime: {
      name: "browser",
      version: navigator.userAgent,
      extras: {},
    },
    result: { smoke_test: "ok" },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  metaEl.textContent =
    "Smoke test ran without loading Pyodide — only the helper plumbing is exercised.";
  outputEl.textContent = JSON.stringify(envelope, null, 2);
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  setVerdict(
    "unreproduced",
    `smoke test failed: ${errAny?.message ?? String(err)}`,
  );
}
