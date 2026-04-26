// Vivarium Layer 1 PoC — pandas-dev/pandas#56679
//
// Loads Pyodide in the browser, runs a 3-line pandas reproduction, and
// surfaces a mechanically-distinguishable verdict ("reproduction succeeded"
// vs "reproduction failed") both in the DOM and on `window`.
//
// Verdict semantics:
//   - "succeeded" — the bug reproduces (Series dtype != DataFrame dtype).
//   - "failed"    — the bug does NOT reproduce (or the runtime errored).
// Phase 0 PoC contract — extended in later phases when the framework lands.

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

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

const verdictEl = document.getElementById("verdict");
const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

reproCodeEl.textContent = REPRO_CODE;

function setVerdict(state, message) {
  verdictEl.classList.remove("pass", "fail", "pending");
  verdictEl.classList.add(state);
  verdictEl.dataset.verdict = state;
  verdictEl.textContent = message;
  // Published for headless harnesses (Playwright, Preview MCP, etc.).
  globalThis.__VIVARIUM_VERDICT__ = state;
}

function setMeta(text) {
  metaEl.textContent = text;
}

async function run() {
  setVerdict("pending", "Loading Pyodide runtime and pandas…");
  setMeta(`Pyodide v${PYODIDE_VERSION} from cdn.jsdelivr.net`);

  const { loadPyodide } = await import(PYODIDE_URL);
  // `packages` lets Pyodide fetch the pandas wheel in parallel with the
  // runtime bootstrap, instead of serialising it after `loadPyodide` resolves.
  const pyodide = await loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    packages: ["pandas"],
  });

  setVerdict("pending", "Running reproduction script…");
  const proxy = await pyodide.runPythonAsync(REPRO_CODE);
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy?.();

  setMeta(
    `pandas ${result.pandas_version} on Python ${result.python_version} ` +
      `via Pyodide v${PYODIDE_VERSION}.`,
  );
  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.mismatch) {
    setVerdict(
      "pass",
      "reproduction succeeded — Series dtype ≠ DataFrame dtype.",
    );
  } else {
    setVerdict(
      "fail",
      "reproduction failed — dtypes are consistent in this pandas build.",
    );
  }
  globalThis.__VIVARIUM_RESULT__ = result;
}

run().catch((err) => {
  console.error(err);
  outputEl.textContent = (err && (err.stack || err.message)) || String(err);
  setVerdict(
    "fail",
    `reproduction failed — runtime error: ${err.message ?? err}`,
  );
});
