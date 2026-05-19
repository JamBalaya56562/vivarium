// Vivarium Layer 1 reproduction — mpmath/mpmath#930.
//
// At default precision (`mp.dps=15`),
//   mpmath.jtheta(2, mpc('99','1'), mpc('0.99','0'))
// returns roughly `-1.73e9 + 7.19e8j`. The correct value (verified
// at `mp.dps=200`, matching Mathematica) is roughly
// `-1.50e-57 + 1.13e-58j` — off by about 66 orders of magnitude.
// Silent precision loss inside the Jacobi-theta sum for arguments
// with large imaginary part of `z` and `|q|` close to 1.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced"   — magnitude > 1e6 (the bug puts it near 1.87e9).
//   - "unreproduced" — magnitude < 1e6 (default dps now gives a
//                      correctly-small value, i.e. fixed upstream),
//                      or the runtime errored.
//
// mpmath is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. mpmath is pure
// Python with no compiled deps, so the install is a single PyPI
// wheel — well under the Playwright timeout.

import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const BASELINE_SPEC = 'mpmath==1.4.1';

const REPRO_CODE = `
import sys
import mpmath
from mpmath import mpc

result_value = mpmath.jtheta(2, mpc('99', '1'), mpc('0.99', '0'))
real = float(mpmath.re(result_value))
imag = float(mpmath.im(result_value))
magnitude = float(abs(result_value))

{
    "mpmath_version": mpmath.__version__,
    "python_version": sys.version.split()[0],
    "mp_dps": mpmath.mp.dps,
    "result_real": real,
    "result_imag": imag,
    "result_abs": magnitude,
    "reproduced": magnitude > 1e6,
}
`.trim();

interface ReproOutput {
  mpmath_version: string;
  python_version: string;
  mp_dps: number;
  result_real: number;
  result_imag: number;
  result_abs: number;
  reproduced: boolean;
}

interface PyodideRuntime {
  loadPackage(name: string | string[]): Promise<void>;
  pyimport(module: string): {
    install(spec: string): Promise<void>;
  };
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
    'mpmath-930: missing required DOM elements (#output, #meta, #repro-code).',
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
        `bug reproduced — jtheta returned magnitude ${result.result_abs.toExponential(3)} ` +
        `at dps=${result.mp_dps}, expected ~1.5e-57.`,
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      `bug not reproduced — jtheta returned magnitude ${result.result_abs.toExponential(3)} ` +
      `(default dps appears to deliver the correct small value).`,
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
  const runtime = pyodide as PyodideRuntime;

  setVerdict('pending', `Installing ${BASELINE_SPEC} from PyPI…`);
  const micropip = runtime.pyimport('micropip');
  await micropip.install(BASELINE_SPEC);

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
    `mpmath ${baselineResult.mpmath_version} on Python ` +
    `${baselineResult.python_version} via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'mpmath',
      issue: 930,
      upstream_url: 'https://github.com/mpmath/mpmath/issues/930',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        mpmath: baselineResult.mpmath_version,
      },
    },
    result: {
      mp_dps: baselineResult.mp_dps,
      result_real: baselineResult.result_real,
      result_imag: baselineResult.result_imag,
      result_abs: baselineResult.result_abs,
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
    slug: 'mpmath-930',
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
