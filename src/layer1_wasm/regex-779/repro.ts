// Vivarium Layer 1 reproduction — rust-lang/regex#779.
//
// `(re)+` should be equivalent to `(re)(re)*`. With `(?m)(^|a)+`
// against the haystack "a\naaa\n", the two equivalent forms produce
// different match-iteration outputs in the rust-lang/regex crate
// (and in RE2, Go's regexp). PCRE2 gets it right, so this is an
// algebraic regex-engine bug, not a regex-language ambiguity.
//
// The actual reproduction logic lives in `src/main.rs` and ships as
// `repro.wasm` (built by deploy-docs CI from `Cargo.toml`). This
// TypeScript file only loads the artefact through the WASI shim,
// captures stdout, parses the JSON envelope, and reports the verdict.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "pass" — the bug REPRODUCES (the two patterns disagree).
//   - "fail" — the bug does NOT reproduce (regex now agrees, the
//     wasm artefact errored, or the WASI shim could not load).

import { loadVivariumRust } from "../_shared/rust_loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

interface ReproOutput {
  regex_crate_version: string;
  haystack: string;
  pattern_plus: string;
  pattern_expanded: string;
  matches_plus: [number, number][];
  matches_expanded: [number, number][];
  reproduced: boolean;
}

const REPRO_SOURCE_HINT = `
// src/main.rs (excerpt — see this directory for the full crate)
let haystack = "a\\naaa\\n";
let re_plus     = Regex::new("(?m)(^|a)+").unwrap();
let re_expanded = Regex::new("(?m)(^|a)(^|a)*").unwrap();

let matches_plus     = re_plus.find_iter(haystack)
    .map(|m| (m.start(), m.end())).collect::<Vec<_>>();
let matches_expanded = re_expanded.find_iter(haystack)
    .map(|m| (m.start(), m.end())).collect::<Vec<_>>();

let reproduced = matches_plus != matches_expanded;
`.trim();

const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "regex-779: missing required DOM elements (#output, #meta, #repro-code).",
  );
}

reproCodeEl.textContent = REPRO_SOURCE_HINT;

const startedAt = new Date();

try {
  const { rust, wasiShimVersion } = await loadVivariumRust({
    wasmUrl: "./repro.wasm",
    pendingText: "Loading Rust wasm32-wasip1 artefact via WASI shim…",
  });

  setVerdict("pending", "Running reproduction script…");
  const { exitCode, stdout, stderr } = await rust.run();
  if (stdout.trim().length === 0) {
    throw new Error(
      `wasm produced no stdout (exitCode=${exitCode}, stderr=${stderr})`,
    );
  }
  const result = JSON.parse(stdout) as ReproOutput;

  metaEl.textContent =
    `regex crate ${result.regex_crate_version} on wasm32-wasip1 ` +
    `via @bjorn3/browser_wasi_shim v${wasiShimVersion}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.reproduced && exitCode === 0) {
    setVerdict(
      "pass",
      "reproduction succeeded — `(re)+` and `(re)(re)*` produce different match lists on the same haystack.",
    );
  } else if (!result.reproduced && exitCode === 1) {
    setVerdict(
      "fail",
      "reproduction failed — `(re)+` and `(re)(re)*` now produce identical match lists (likely fixed upstream).",
    );
  } else {
    setVerdict(
      "fail",
      `reproduction failed — unexpected outcome (exitCode=${exitCode}, reproduced=${result.reproduced}).`,
    );
  }

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "regex",
      issue: 779,
      upstream_url: "https://github.com/rust-lang/regex/issues/779",
    },
    runtime: {
      name: "rust-wasi",
      version: wasiShimVersion,
      extras: {
        regex_crate: result.regex_crate_version,
        wasi_target: "wasm32-wasip1",
      },
    },
    result: {
      pattern_plus: result.pattern_plus,
      pattern_expanded: result.pattern_expanded,
      matches_plus: result.matches_plus,
      matches_expanded: result.matches_expanded,
      reproduced: result.reproduced,
      exit_code: exitCode,
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
  if (globalThis.__VIVARIUM_VERDICT__ !== "fail") {
    setVerdict(
      "fail",
      `reproduction failed — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
