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

const BASELINE_REGEX_VERSION = "1.8.4";
const FIX_REGEX_VERSION = "1.13.1";

function setFixPane(
  text: string,
  status: "pending" | "ok" | "error",
): void {
  outputFixEl!.textContent = text;
  outputFixEl!.dataset["fixStatus"] = status;
}

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
        ...(fix ? { regex_crate_fix_candidate: fix.regex_crate_version } : {}),
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
