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
  DEFAULT_PYODIDE_VERSION,
  loadVivariumPyodide,
} from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

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

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'pandas-56679: missing required DOM elements (#output, #meta, #repro-code).',
  );
}

// Build-time inlining (`scripts/highlight-repros.ts`) populates this
// element in `index.html` with the syntax-highlighted source spans,
// so the page paints the code at HTML-parse time. The runtime
// fallback below kicks in only when the placeholder is still empty.
if (!reproCodeEl.firstChild) {
  reproCodeEl.textContent = REPRO_CODE;
  fetch('./repro.highlighted.html')
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (html) reproCodeEl.innerHTML = html;
    })
    .catch(() => {});
}

function evaluate(result: ReproOutput): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (result.mismatch) {
    return {
      verdict: 'reproduced',
      message: 'bug reproduced — Series dtype ≠ DataFrame dtype.',
    };
  }
  return {
    verdict: 'unreproduced',
    message: 'bug not reproduced — dtypes are consistent in this pandas build.',
  };
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const result = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    const ev = evaluate(result);
    return {
      exitCode: 0,
      verdict: ev.verdict,
      message: ev.message,
      stdout: JSON.stringify(result, null, 2),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      verdict: 'unreproduced',
      message: `runtime error: ${message}`,
      stdout: message,
    };
  }
}

const startedAt = new Date();

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['pandas'],
    pendingText: 'Loading Pyodide runtime and pandas…',
  });

  setVerdict('pending', 'Running reproduction script…');
  const runtime = pyodide as PyodideRuntime;
  const baseline = await captureRun(runtime, REPRO_CODE);

  let baselineResult: ReproOutput | null = null;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    outputEl.textContent = baseline.stdout;
    setVerdict(baseline.verdict, baseline.message);
    throw new Error(baseline.message);
  }

  metaEl.textContent =
    `pandas ${baselineResult.pandas_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'pandas',
      issue: 56679,
      upstream_url: 'https://github.com/pandas-dev/pandas/issues/56679',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        pandas: baselineResult.pandas_version,
      },
    },
    result: {
      series_dtype: baselineResult.series_dtype,
      df_dtype: baselineResult.df_dtype,
      mismatch: baselineResult.mismatch,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  // Wire the editable script + Run button.
  enableRunner({
    slug: 'pandas-56679',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  // `loadVivariumPyodide` already sets the verdict to "unreproduced" on load-time
  // errors. Cover the case where the runtime loaded but the reproduction
  // itself errored — e.g. an unexpected pandas API change.
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}

// Suppress "DEFAULT_PYODIDE_VERSION imported but unused" — keeping the
// re-export visible so the version pin is discoverable from this file.
void DEFAULT_PYODIDE_VERSION;
