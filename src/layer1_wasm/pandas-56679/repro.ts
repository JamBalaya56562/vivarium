import type { PathACapturedRun } from '../_shared/path_a.js';
import {
  type PyodideWorker,
  type RunResult,
  startPyodideWorker,
} from '../_shared/pyodide-worker-client.js';
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
df_dtype = str(pd.DataFrame({"a": []})["a"].dtype)
mismatch = series_dtype != df_dtype

result = {
    "pandas_version": pd.__version__,
    "python_version": sys.version.split()[0],
    "series_dtype": series_dtype,
    "df_dtype": df_dtype,
    "mismatch": mismatch,
}

print("Two empty containers built from the same empty input:")
print()
print("pd.Series([]).dtype".ljust(36) + "-> " + series_dtype)
print('pd.DataFrame({"a": []})["a"].dtype'.ljust(36) + "-> " + df_dtype)
print()
if mismatch:
    print("The two disagree: the same empty input yields different dtypes.")
else:
    print("The two agree: both empty containers report the same dtype.")
print("pandas " + result["pandas_version"] + " / Python " + result["python_version"])
`.trim();

interface ReproOutput {
  pandas_version: string;
  python_version: string;
  series_dtype: string;
  df_dtype: string;
  mismatch: boolean;
}

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'pandas-56679: missing required DOM elements (#output, #meta, #repro-code).',
  );
}

if (!reproCodeEl.firstChild) {
  reproCodeEl.textContent = REPRO_CODE;
  fetch('./repro.highlighted.html')
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (html) reproCodeEl.innerHTML = html;
    })
    .catch(() => {});
}

function evaluate(result: ReproOutput | null): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (!result) {
    return {
      verdict: 'unreproduced',
      message: 'bug not reproduced — the script left no `result` mapping behind.',
    };
  }
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

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
}

function toCapture(run: RunResult): CaptureResult {
  if (run.error !== null) {
    return {
      run: {
        exitCode: 1,
        verdict: 'unreproduced',
        message: `runtime error: ${run.error}`,
        stdout: run.stdout,
      },
      parsed: null,
    };
  }
  const parsed = (run.value as ReproOutput | null) ?? null;
  const ev = evaluate(parsed);
  return {
    run: {
      exitCode: parsed ? 0 : 1,
      verdict: ev.verdict,
      message: ev.message,
      stdout: run.stdout,
    },
    parsed,
  };
}

async function captureIn(
  worker: PyodideWorker,
  source: string,
): Promise<CaptureResult> {
  return toCapture(await worker.run(source));
}

const startedAt = new Date();

try {
  const worker = await startPyodideWorker({
    packages: ['pandas'],
    runtimeLabel: {
      en: 'Loading runtime + pandas…',
      ja: 'runtime と pandas を読み込み中…',
    },
  });

  setVerdict('pending', 'Running reproduction script…', 'running');
  const baseline = await captureIn(worker, REPRO_CODE);
  outputEl.textContent = baseline.run.stdout;
  setVerdict(baseline.run.verdict, baseline.run.message);

  const baselineResult = baseline.parsed;
  if (!baselineResult) {
    throw new Error(baseline.run.message);
  }

  metaEl.textContent =
    `pandas ${baselineResult.pandas_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${worker.pyodideVersion} (Web Worker).`;

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
      version: worker.pyodideVersion,
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

  enableRunner({
    slug: 'pandas-56679',
    baselineSource: REPRO_CODE,
    runFix: async (source) => (await captureIn(worker, source)).run,
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
