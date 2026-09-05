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
let pattern_plus = "(?m)(^|a)+";
let pattern_expanded = "(?m)(^|a)(^|a)*";

let re_plus = Regex::new(pattern_plus).expect("compile (re)+ pattern");
let re_expanded = Regex::new(pattern_expanded).expect("compile (re)(re)* pattern");

let matches_plus = matches(&re_plus, haystack);
let matches_expanded = matches(&re_expanded, haystack);
let reproduced = matches_plus != matches_expanded;

println!("find_iter over haystack {haystack:?}");
println!();
println!("{pattern_plus:<20}{}", format_spans(&matches_plus));
println!("{pattern_expanded:<20}{}", format_spans(&matches_expanded));
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

function parseMachineLine(stderr: string): ReproOutput | null {
  const line = stderr.split("\n").find((l) => l.startsWith("{"));
  if (!line) return null;
  try {
    return JSON.parse(line) as ReproOutput;
  } catch {
    return null;
  }
}

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
  const result = parseMachineLine(stderr);
  if (!result) {
    throw new Error(
      `wasm produced no machine-readable line on stderr (exitCode=${exitCode}, stderr=${stderr})`,
    );
  }

  outputEl.textContent = stdout.trimEnd();

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
    fixResult = parseMachineLine(fixRun.stderr);
    if (!fixResult) {
      throw new Error(
        `fix-candidate wasm produced no machine-readable line on stderr (exitCode=${fixRun.exitCode}, stderr=${fixRun.stderr})`,
      );
    }
    fixExitCode = fixRun.exitCode;
    setFixPane(fixRun.stdout.trimEnd(), "ok");
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
