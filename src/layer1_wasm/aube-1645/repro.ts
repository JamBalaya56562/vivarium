import { loadVivariumRust } from "../_shared/rust_loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

interface PackageRow {
  name: string;
  specifier: string;
  lockfile_version: string;
  package_json_version: string;
}

interface ReproOutput {
  aube: string;
  packages: PackageRow[];
  reproduced: boolean;
}

const REPRO_SOURCE_HINT = `
// src/repro.rs (excerpt — compiled by both crates in this directory)
const AUBE_LOCK_YAML: &str = "lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      filedep:
        specifier: file:./filedep
        version: file:./filedep
      linked:
        specifier: link:../outside/linked
        version: link:../outside/linked

packages:

  filedep@file:./filedep:
    resolution: {directory: ./filedep, type: directory}
...";

// app/filedep/package.json         { "name": "filedep", "version": "1.0.0" }
// outside/linked/package.json      { "name": "linked", "version": "2.0.0" }
let app = project();
let manifest =
    PackageJson::from_path(&app.join("package.json")).expect("read app/package.json");
let graph = aube_lockfile::parse_lockfile(&app, &manifest).expect("parse app/aube-lock.yaml");

for pkg in graph.packages.values() {
    // pkg.version for each file: / link: package, next to the
    // version in that package's own package.json
}
`.trim();

const outputEl = document.getElementById("output");
const outputFixEl = document.getElementById("output-fix");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "aube-1645: missing required DOM elements (#output, #output-fix, #meta, #repro-code).",
  );
}

const BASELINE_AUBE = "v2.6.1";
const FIX_AUBE = "#1645 (8b56aa1e)";

// The reproduction writes its fixture project under /tmp before handing
// it to aube's lockfile reader, so each run gets a fresh in-memory /tmp.
const PREOPENS = ["/tmp"];

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
    preopens: PREOPENS,
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
      "bug reproduced — file: and link: dependencies read from the lockfile carry version 0.0.0 instead of their package.json version.",
    );
  } else if (!result.reproduced && exitCode === 1) {
    setVerdict(
      "unreproduced",
      "bug not reproduced — the lockfile graph carries each local dependency's real version (likely fixed upstream).",
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
      project: "aube",
      issue: 1645,
      upstream_url: "https://github.com/aubepkg/aube/pull/1645",
    },
    runtime: {
      name: "rust-wasi",
      version: wasiShimVersion,
      extras: {
        aube: result.aube,
        ...(fix ? { aube_fix_candidate: fix.aube } : {}),
        wasi_target: "wasm32-wasip1",
      },
    },
    result: {
      packages: result.packages,
      reproduced: result.reproduced,
      exit_code: exitCode,
      baseline: {
        spec: `aube ${BASELINE_AUBE}`,
        packages: result.packages,
        reproduced: result.reproduced,
        exit_code: exitCode,
      },
      fix_candidate: fix
        ? {
            spec: `aube ${FIX_AUBE}`,
            packages: fix.packages,
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

  setFixPane(`Loading aube ${FIX_AUBE} build…`, "pending");
  let fixResult: ReproOutput | null = null;
  let fixExitCode: number | null = null;
  try {
    const { rust: rustFix } = await loadVivariumRust({
      wasmUrl: "./repro-fix.wasm",
      announceVerdict: false,
      preopens: PREOPENS,
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
    `aube ${result.aube} (baseline)` +
    (fixResult ? ` vs ${fixResult.aube} (fix candidate)` : "") +
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
