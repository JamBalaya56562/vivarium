// Vivarium Layer 1 reproduction — numpy/numpy#28287.
//
// `timedelta64` ordering is non-transitive when one of the values uses
// the generic unit. With:
//   x = np.timedelta64(1, "ms")
//   y = np.timedelta64(2)         # generic unit
//   z = np.timedelta64(5, "ns")
// NumPy reports x < y and y < z but x > z — a transitivity violation.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — the bug REPRODUCES (numpy reports the non-transitive
//     ordering on the build Pyodide ships).
//   - "unreproduced" — the bug does NOT reproduce (or the runtime errored).

import { loadVivariumPyodide } from "../_shared/loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

const REPRO_CODE = `
import sys
import numpy as np

x = np.timedelta64(1, "ms")
y = np.timedelta64(2)
z = np.timedelta64(5, "ns")

x_lt_y = bool(x < y)
y_lt_z = bool(y < z)
x_lt_z = bool(x < z)

{
    "numpy_version": np.__version__,
    "python_version": sys.version.split()[0],
    "x_lt_y": x_lt_y,
    "y_lt_z": y_lt_z,
    "x_lt_z": x_lt_z,
    "transitivity_violated": x_lt_y and y_lt_z and not x_lt_z,
}
`.trim();

interface ReproOutput {
  numpy_version: string;
  python_version: string;
  x_lt_y: boolean;
  y_lt_z: boolean;
  x_lt_z: boolean;
  transitivity_violated: boolean;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<{
    toJs(opts: { dict_converter: typeof Object.fromEntries }): ReproOutput;
    destroy?(): void;
  }>;
}

const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "numpy-28287: missing required DOM elements (#output, #meta, #repro-code).",
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
  // numpy is shipped with the Pyodide distribution but must be installed
  // explicitly via `loadPackage` / the `packages` option — it is not
  // imported at runtime startup.
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ["numpy"],
    pendingText: "Loading Pyodide runtime and numpy…",
  });

  setVerdict("pending", "Running reproduction script…");
  const runtime = pyodide as PyodideRuntime;
  const proxy = await runtime.runPythonAsync(REPRO_CODE);
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy?.();

  metaEl.textContent =
    `numpy ${result.numpy_version} on Python ${result.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.transitivity_violated) {
    setVerdict(
      "reproduced",
      "bug reproduced — timedelta64 ordering is non-transitive (x < y < z but x ≥ z).",
    );
  } else {
    setVerdict(
      "unreproduced",
      "bug not reproduced — timedelta64 ordering is transitive in this numpy build.",
    );
  }

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "numpy",
      issue: 28287,
      upstream_url: "https://github.com/numpy/numpy/issues/28287",
    },
    runtime: {
      name: "pyodide",
      version,
      extras: {
        python: result.python_version,
        numpy: result.numpy_version,
      },
    },
    result: {
      x_lt_y: result.x_lt_y,
      y_lt_z: result.y_lt_z,
      x_lt_z: result.x_lt_z,
      transitivity_violated: result.transitivity_violated,
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
  // `loadVivariumPyodide` already sets "unreproduced" on load-time errors. Cover
  // the case where the runtime loaded but the reproduction itself errored.
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
