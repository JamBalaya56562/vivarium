// Vivarium Layer 1 reproduction — rust-lang/regex#779.
//
// `(re)+` should be equivalent to `(re)(re)*`. With `(?m)(^|a)+`
// against the haystack "a\naaa\n", the two equivalent forms produce
// different match-iteration outputs in the rust-lang/regex crate
// (and in RE2, Go's regexp). PCRE2 gets it right, so this is an
// algebraic regex-engine bug, not a regex-language ambiguity.
//
// The reproduction logic lives in `src/repro.rs` and is compiled twice
// from that one source, differing only in the `regex` version each
// crate pins:
//
//   Cargo.toml      regex =1.8.4    -> repro.wasm      (baseline)
//   fix/Cargo.toml  regex =1.13.1   -> repro-fix.wasm  (fix candidate)
//
// This TypeScript file loads both artefacts through the WASI shim and
// writes each one's JSON into its own pane, so a visitor sees the wrong
// answer and the right one side by side.
//
// Verdict semantics (per ADR-0008 / contract v1) describe the BASELINE
// only:
//   - "reproduced" — the bug REPRODUCES (the two patterns disagree).
//   - "unreproduced" — the bug does NOT reproduce (regex now agrees, the
//     wasm artefact errored, or the WASI shim could not load).
//
// The fix-candidate build is expected to disagree with the baseline —
// that is the point — so it never touches the verdict pill. Its load
// passes `announceVerdict: false`, and a failure to fetch or run it
// leaves the baseline verdict standing and reports the error in the
// fix pane.

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
// src/repro.rs (excerpt — compiled by both crates in this directory)
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
const outputFixEl = document.getElementById("output-fix");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "regex-779: missing required DOM elements (#output, #output-fix, #meta, #repro-code).",
  );
}

/** The `regex` releases the two crates pin. Keep in sync with
 *  `Cargo.toml` and `fix/Cargo.toml` — the pages report these strings,
 *  and the wasm builds report their own, so a drift is visible rather
 *  than silent. */
const BASELINE_REGEX_VERSION = "1.8.4";
const FIX_REGEX_VERSION = "1.13.1";

/** Write into the fix pane and stamp the machine-readable state the
 *  Playwright suite asserts on (locale-independent, unlike the text). */
function setFixPane(
  text: string,
  status: "pending" | "ok" | "error",
): void {
  outputFixEl!.textContent = text;
  outputFixEl!.dataset["fixStatus"] = status;
}

// Build-time inlining (`scripts/highlight-repros.ts`) populates this
// element in `index.html` with the syntax-highlighted source spans,
// so the page paints the code at HTML-parse time. The runtime
// fallback below kicks in only when the placeholder is still empty —
// e.g. dev hot-reload before the highlight script has run, or a
// mid-edit state where the inline got lost.
if (!reproCodeEl.firstChild) {
  reproCodeEl.textContent = REPRO_SOURCE_HINT;
  fetch("./repro.highlighted.html")
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (html) reproCodeEl.innerHTML = html;
    })
    .catch(() => {});
}

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

  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.reproduced && exitCode === 0) {
    setVerdict(
      "reproduced",
      "bug reproduced — `(re)+` and `(re)(re)*` produce different match lists on the same haystack.",
    );
  } else if (!result.reproduced && exitCode === 1) {
    setVerdict(
      "unreproduced",
      "bug not reproduced — `(re)+` and `(re)(re)*` now produce identical match lists (likely fixed upstream).",
    );
  } else {
    setVerdict(
      "unreproduced",
      `bug not reproduced — unexpected outcome (exitCode=${exitCode}, reproduced=${result.reproduced}).`,
    );
  }

  // Publish a baseline-only envelope BEFORE the fix-candidate run.
  // The Playwright suite reads `__VIVARIUM_RESULT__` the moment
  // `data-verdict` leaves "pending", so the envelope has to be there
  // already; the fix-candidate fields are added in a second publish.
  const buildEnvelope = (
    finishedAt: Date,
    fix: ReproOutput | null,
    fixExitCode: number | null,
  ): VivariumResultV1 => ({
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
        // Omitted rather than nulled when the fix build did not run —
        // `extras` is `Record<string, string>`, and an absent key reads
        // the same way to a consumer feature-detecting the field.
        ...(fix ? { regex_crate_fix_candidate: fix.regex_crate_version } : {}),
        wasi_target: "wasm32-wasip1",
      },
    },
    result: {
      // Flat fields describe the baseline, unchanged for existing
      // consumers. `baseline` / `fix_candidate` are additive — Contract
      // v1 revision, no version bump (AGENTS.md 4.10).
      pattern_plus: result.pattern_plus,
      pattern_expanded: result.pattern_expanded,
      matches_plus: result.matches_plus,
      matches_expanded: result.matches_expanded,
      reproduced: result.reproduced,
      exit_code: exitCode,
      baseline: {
        spec: `regex =${BASELINE_REGEX_VERSION}`,
        matches_plus: result.matches_plus,
        matches_expanded: result.matches_expanded,
        reproduced: result.reproduced,
        exit_code: exitCode,
      },
      fix_candidate: fix
        ? {
            spec: `regex =${FIX_REGEX_VERSION}`,
            matches_plus: fix.matches_plus,
            matches_expanded: fix.matches_expanded,
            reproduced: fix.reproduced,
            exit_code: fixExitCode,
          }
        : null,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  });

  setResult(buildEnvelope(new Date(), null, null));

  // ── Fix-candidate build ────────────────────────────────────────────
  // Never allowed to move the verdict pill: `announceVerdict: false`
  // keeps a 404 on repro-fix.wasm from flipping a correct "reproduced"
  // into a fix that was never observed.
  setFixPane(`Loading regex ${FIX_REGEX_VERSION} build…`, "pending");
  let fixResult: ReproOutput | null = null;
  let fixExitCode: number | null = null;
  try {
    const { rust: rustFix } = await loadVivariumRust({
      wasmUrl: "./repro-fix.wasm",
      announceVerdict: false,
    });
    const fixRun = await rustFix.run();
    if (fixRun.stdout.trim().length === 0) {
      throw new Error(
        `fix-candidate wasm produced no stdout (exitCode=${fixRun.exitCode}, stderr=${fixRun.stderr})`,
      );
    }
    fixResult = JSON.parse(fixRun.stdout) as ReproOutput;
    fixExitCode = fixRun.exitCode;
    setFixPane(JSON.stringify(fixResult, null, 2), "ok");
  } catch (fixErr: unknown) {
    const fixErrAny = fixErr as { message?: string } | null;
    console.error(fixErr);
    setFixPane(
      `Fix-candidate build unavailable: ${fixErrAny?.message ?? String(fixErr)}`,
      "error",
    );
  }

  metaEl.textContent =
    `regex crate ${result.regex_crate_version} (baseline)` +
    (fixResult ? ` vs ${fixResult.regex_crate_version} (fix candidate)` : "") +
    ` on wasm32-wasip1 via @bjorn3/browser_wasi_shim v${wasiShimVersion}.`;

  setResult(buildEnvelope(new Date(), fixResult, fixExitCode));
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  setFixPane(
    "Not run — the baseline build failed, so there is nothing to compare against.",
    "error",
  );
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
