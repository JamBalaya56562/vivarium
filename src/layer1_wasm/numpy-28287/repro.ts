import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const REPRO_CODE = `
import sys

import numpy as np

x = np.timedelta64(1, "ms")
y = np.timedelta64(2)
z = np.timedelta64(5, "ns")

x_lt_y = bool(x < y)
y_lt_z = bool(y < z)
x_lt_z = bool(x < z)
transitivity_violated = x_lt_y and y_lt_z and not x_lt_z

result = {
    "numpy_version": np.__version__,
    "python_version": sys.version.split()[0],
    "x_lt_y": x_lt_y,
    "y_lt_z": y_lt_z,
    "x_lt_z": x_lt_z,
    "transitivity_violated": transitivity_violated,
}

broken = "   <-- transitivity broken" if transitivity_violated else ""

print("Three timedelta64 values, two of them carrying a unit:")
print()
print("x = 1 ms")
print("y = 2 (generic unit)")
print("z = 5 ns")
print()
print("x < y  -> " + str(x_lt_y))
print("y < z  -> " + str(y_lt_z))
print("x < z  -> " + str(x_lt_z) + broken)
print()
if transitivity_violated:
    print("Ordering is not transitive: x < y and y < z, yet x >= z.")
else:
    print("Ordering is transitive on these three values.")
print("numpy " + result["numpy_version"] + " / Python " + result["python_version"])
`.trim();

interface ReproOutput {
  numpy_version: string;
  python_version: string;
  x_lt_y: boolean;
  y_lt_z: boolean;
  x_lt_z: boolean;
  transitivity_violated: boolean;
}

interface PyProxy {
  toJs(opts: { dict_converter: typeof Object.fromEntries }): unknown;
  destroy?(): void;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { batched: (text: string) => void }): void;
  globals: {
    get(name: string): unknown;
    has(name: string): boolean;
    delete(name: string): void;
  };
}

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'numpy-28287: missing required DOM elements (#output, #meta, #repro-code).',
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
  if (result.transitivity_violated) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — timedelta64 ordering is non-transitive (x < y < z but x ≥ z).',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — timedelta64 ordering is transitive in this numpy build.',
  };
}

function isPyProxy(value: unknown): value is PyProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PyProxy).toJs === 'function'
  );
}

function readResult(runtime: PyodideRuntime): ReproOutput | null {
  const handle = runtime.globals.get('result');
  if (!isPyProxy(handle)) return null;
  try {
    return handle.toJs({ dict_converter: Object.fromEntries }) as ReproOutput;
  } finally {
    handle.destroy?.();
  }
}

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<CaptureResult> {
  const lines: string[] = [];
  runtime.setStdout({
    batched: (text) => {
      lines.push(text);
    },
  });
  // One Pyodide namespace spans every run: an edited script that never
  // assigns `result` would otherwise be judged on the previous run's values.
  if (runtime.globals.has('result')) runtime.globals.delete('result');

  try {
    await runtime.runPythonAsync(source);
    const parsed = readResult(runtime);
    const ev = evaluate(parsed);
    return {
      run: {
        exitCode: parsed ? 0 : 1,
        verdict: ev.verdict,
        message: ev.message,
        stdout: lines.join('\n'),
      },
      parsed,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      run: {
        exitCode: 1,
        verdict: 'unreproduced',
        message: `runtime error: ${message}`,
        stdout: [...lines, message].join('\n'),
      },
      parsed: null,
    };
  }
}

const startedAt = new Date();

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['numpy'],
    pendingText: 'Loading Pyodide runtime and numpy…',
  });

  setVerdict('pending', 'Running reproduction script…');
  const runtime = pyodide as PyodideRuntime;
  const baseline = await captureRun(runtime, REPRO_CODE);

  outputEl.textContent = baseline.run.stdout;
  setVerdict(baseline.run.verdict, baseline.run.message);

  const baselineResult = baseline.parsed;
  if (!baselineResult) {
    throw new Error(baseline.run.message);
  }

  metaEl.textContent =
    `numpy ${baselineResult.numpy_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${version}.`;

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'numpy',
      issue: 28287,
      upstream_url: 'https://github.com/numpy/numpy/issues/28287',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        numpy: baselineResult.numpy_version,
      },
    },
    result: {
      x_lt_y: baselineResult.x_lt_y,
      y_lt_z: baselineResult.y_lt_z,
      x_lt_z: baselineResult.x_lt_z,
      transitivity_violated: baselineResult.transitivity_violated,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'numpy-28287',
    baselineSource: REPRO_CODE,
    runFix: async (source) => (await captureRun(runtime, source)).run,
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
