// Vivarium Layer 1 reproduction — mpmath/mpmath#983.
//
// `mp.qr_solve(A, b)` raises `ValueError: matrix is numerically
// singular` on a well-conditioned 4×4 polynomial-interpolation
// system that `mp.lu_solve(A, b)` handles fine. Wolfram|Alpha
// confirms the matrix is invertible (condition number ≈ 695). The
// Householder QR path's guard
// `if not abs(s) > ctx.eps:` (mpmath/matrices/linalg.py:333) trips
// on a sub-eps intermediate sum that the LU path never sees;
// raising precision via `mp.dps = 10` works around it.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — qr_solve raised AND lu_solve succeeded on the
//     same system (the upstream-reported asymmetry).
//   - "unreproduced" — the two solvers no longer disagree (qr_solve
//     accepted the system, or lu_solve also failed, or the runtime
//     errored before producing a result).
//
// mpmath is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. mpmath has no
// runtime dependencies beyond the Python stdlib, so the install is
// a single pure-Python wheel from PyPI.

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
import mpmath
from mpmath import mp

A = mp.matrix([
    [mp.one, -mp.pi / 20, (-mp.pi / 20) ** 2, (-mp.pi / 20) ** 3],
    [mp.one, mp.zero, mp.zero, mp.zero],
    [mp.one, mp.pi / 20, (mp.pi / 20) ** 2, (mp.pi / 20) ** 3],
    [mp.one, mp.pi / 10, (mp.pi / 10) ** 2, (mp.pi / 10) ** 3],
])
b = mp.matrix([
    [mp.sin(-mp.pi / 20)],
    [mp.zero],
    [mp.sin(mp.pi / 20)],
    [mp.sin(mp.pi / 20)],
])

result = {
    "mpmath_version": mpmath.__version__,
    "python_version": sys.version.split()[0],
    "mp_dps": mp.dps,
    "qr_solve_raised": False,
    "qr_solve_error": None,
    "lu_solve_succeeded": False,
    "lu_solve_solution": None,
    "asymmetry": False,
}

try:
    mp.qr_solve(A, b)
except ValueError as e:
    result["qr_solve_raised"] = True
    result["qr_solve_error"] = str(e)[:200]

try:
    x_lu = mp.lu_solve(A, b)
    result["lu_solve_succeeded"] = True
    result["lu_solve_solution"] = [mp.nstr(x_lu[i, 0], 6) for i in range(4)]
except Exception as e:
    result["lu_solve_solution"] = f"lu_solve also raised: {type(e).__name__}: {str(e)[:120]}"

result["asymmetry"] = result["qr_solve_raised"] and result["lu_solve_succeeded"]
result
`.trim();

interface ReproOutput {
  mpmath_version: string;
  python_version: string;
  mp_dps: number;
  qr_solve_raised: boolean;
  qr_solve_error: string | null;
  lu_solve_succeeded: boolean;
  lu_solve_solution: string[] | string | null;
  asymmetry: boolean;
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
    'mpmath-983: missing required DOM elements (#output, #meta, #repro-code).',
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
  if (result.asymmetry) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — qr_solve raised on a system lu_solve handles fine.',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — qr_solve and lu_solve no longer disagree on this system.',
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

  setVerdict('pending', 'Installing mpmath from PyPI…');
  const runtime = pyodide as PyodideRuntime;
  await runtime.runPythonAsync(`
import micropip
await micropip.install("mpmath==1.4.1")
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
    `mpmath ${baselineResult.mpmath_version} on Python ${baselineResult.python_version} ` +
    `(mp.dps=${baselineResult.mp_dps}) via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'mpmath',
      issue: 983,
      upstream_url: 'https://github.com/mpmath/mpmath/issues/983',
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
      qr_solve_raised: baselineResult.qr_solve_raised,
      lu_solve_succeeded: baselineResult.lu_solve_succeeded,
      asymmetry: baselineResult.asymmetry,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'mpmath-983',
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
