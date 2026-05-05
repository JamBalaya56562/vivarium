// Vivarium Layer 1 reproduction — pandas-dev/pandas#56679.
//
// `pd.Series([])` returns dtype `object`, but `pd.DataFrame({'a': []})['a']`
// returns dtype `float64`. The two constructors should produce a consistent
// dtype for an empty input.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — the bug REPRODUCES (Series dtype ≠ DataFrame dtype on the
//     pandas build that Pyodide ships).
//   - "unreproduced" — the bug does NOT reproduce (or the runtime errored).

import {
  loadVivariumPyodide,
  DEFAULT_PYODIDE_VERSION,
} from "../_shared/loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

const REPRO_CODE = `
import sys
import pandas as pd

series_dtype = str(pd.Series([]).dtype)
df_dtype = str(pd.DataFrame({'a': []})['a'].dtype)

{
    "pandas_version": pd.__version__,
    "python_version": sys.version.split()[0],
    "series_dtype": series_dtype,
    "df_dtype": df_dtype,
    "mismatch": series_dtype != df_dtype,
}
`.trim();

interface ReproOutput {
  pandas_version: string;
  python_version: string;
  series_dtype: string;
  df_dtype: string;
  mismatch: boolean;
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
    "pandas-56679: missing required DOM elements (#output, #meta, #repro-code).",
  );
}

reproCodeEl.textContent = REPRO_CODE;

const startedAt = new Date();

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ["pandas"],
    pendingText: "Loading Pyodide runtime and pandas…",
  });

  setVerdict("pending", "Running reproduction script…");
  const runtime = pyodide as PyodideRuntime;
  const proxy = await runtime.runPythonAsync(REPRO_CODE);
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy?.();

  metaEl.textContent =
    `pandas ${result.pandas_version} on Python ${result.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.mismatch) {
    setVerdict(
      "reproduced",
      "bug reproduced — Series dtype ≠ DataFrame dtype.",
    );
  } else {
    setVerdict(
      "unreproduced",
      "bug not reproduced — dtypes are consistent in this pandas build.",
    );
  }

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "pandas",
      issue: 56679,
      upstream_url: "https://github.com/pandas-dev/pandas/issues/56679",
    },
    runtime: {
      name: "pyodide",
      version,
      extras: {
        python: result.python_version,
        pandas: result.pandas_version,
      },
    },
    result: {
      series_dtype: result.series_dtype,
      df_dtype: result.df_dtype,
      mismatch: result.mismatch,
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
  // `loadVivariumPyodide` already sets the verdict to "unreproduced" on load-time
  // errors. Cover the case where the runtime loaded but the reproduction
  // itself errored — e.g. an unexpected pandas API change.
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}

// Suppress "DEFAULT_PYODIDE_VERSION imported but unused" — keeping the
// re-export visible so the version pin is discoverable from this file.
void DEFAULT_PYODIDE_VERSION;
