// Vivarium Layer 1 reproduction — sympy/sympy#29413.
//
// `ask(a + 1 > a, Q.extended_real(a))` returns True under sympy
// 1.14.0, but the correct answer is None: `a + 1 > a` is undefined
// when `a = ±oo` (which `Q.extended_real` admits). Assumption-system
// blind spot in `core.relational`.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced"   — `ask()` returned `True` (the bug).
//   - "unreproduced" — `ask()` returned `None` or `False` (likely
//                      fixed upstream), or the runtime errored before
//                      producing a result.
//
// sympy is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. sympy has only
// pure-Python dependencies (mpmath), so the install is a couple of
// PyPI wheels — slower than `pandas` but still cold-loads in well
// under the Playwright timeout.

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
import sympy
from sympy import ask, Q, Symbol

a = Symbol('a')
result_value = ask(a + 1 > a, Q.extended_real(a))

{
    "sympy_version": sympy.__version__,
    "python_version": sys.version.split()[0],
    "ask_result": repr(result_value),
    "reproduced": result_value is True,
}
`.trim();

interface ReproOutput {
  sympy_version: string;
  python_version: string;
  ask_result: string;
  reproduced: boolean;
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
    'sympy-29413: missing required DOM elements (#output, #meta, #repro-code).',
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

function evaluate(result: ReproOutput): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (result.reproduced) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — ask((a+1)>a, Q.extended_real(a)) returned True, but a=±oo would make this undefined.',
    };
  }
  return {
    verdict: 'unreproduced',
    message: `bug not reproduced — ask returned ${result.ask_result} (expected None for the bug; True signals the blind spot).`,
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
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });

  setVerdict('pending', 'Installing sympy from PyPI…');
  const runtime = pyodide as PyodideRuntime;
  await runtime.runPythonAsync(`
import micropip
await micropip.install("sympy==1.14.0")
`);

  setVerdict('pending', 'Running reproduction script…');
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
    `sympy ${baselineResult.sympy_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'sympy',
      issue: 29413,
      upstream_url: 'https://github.com/sympy/sympy/issues/29413',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        sympy: baselineResult.sympy_version,
      },
    },
    result: {
      ask_result: baselineResult.ask_result,
      reproduced: baselineResult.reproduced,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'sympy-29413',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
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
