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

const outputBaselineEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !metaEl || !reproCodeEl) {
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

// Pyodide maps Python `None` to JS `undefined`, and `JSON.stringify`
// strips `undefined`-valued keys. Normalising here keeps the output
// stable and readable.
function normalize(result: ReproOutput): ReproOutput {
  return {
    mpmath_version: result.mpmath_version,
    python_version: result.python_version,
    mp_dps: result.mp_dps,
    qr_solve_raised: result.qr_solve_raised,
    qr_solve_error: result.qr_solve_error ?? null,
    lu_solve_succeeded: result.lu_solve_succeeded,
    lu_solve_solution: result.lu_solve_solution ?? null,
    asymmetry: result.asymmetry,
  };
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const raw = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    const result = normalize(raw);
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

let baselineCapture: PathACapturedRun | null = null;
let baselineParsed: ReproOutput | null = null;

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });
  const runtime = pyodide as PyodideRuntime;

  setVerdict('pending', 'Installing mpmath==1.4.1 from PyPI…');
  await runtime.runPythonAsync(`
import micropip
await micropip.install("mpmath==1.4.1")
`);

  setVerdict('pending', 'Running reproduction script (baseline)…');
  baselineCapture = await captureRun(runtime, REPRO_CODE);
  try {
    baselineParsed = JSON.parse(baselineCapture.stdout) as ReproOutput;
  } catch {
    baselineParsed = null;
  }
  outputBaselineEl.textContent = baselineCapture.stdout;

  // Build the Contract v1 envelope before flipping the verdict pill:
  // Playwright reads `__VIVARIUM_RESULT__` the moment `data-verdict`
  // leaves `pending`.
  const buildEnvelope = (): VivariumResultV1 | null => {
    if (!baselineParsed || !baselineCapture) return null;
    const finishedAt = new Date();
    return {
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
          python: baselineParsed.python_version,
          mpmath: baselineParsed.mpmath_version,
        },
      },
      result: {
        mp_dps: baselineParsed.mp_dps,
        qr_solve_raised: baselineParsed.qr_solve_raised,
        lu_solve_succeeded: baselineParsed.lu_solve_succeeded,
        asymmetry: baselineParsed.asymmetry,
        baseline: {
          spec: 'mpmath==1.4.1',
          verdict: baselineCapture.verdict,
          mpmath_version: baselineParsed.mpmath_version,
          qr_solve_raised: baselineParsed.qr_solve_raised,
          lu_solve_succeeded: baselineParsed.lu_solve_succeeded,
          asymmetry: baselineParsed.asymmetry,
        },
      },
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      },
    };
  };

  const envelope = buildEnvelope();
  if (envelope) setResult(envelope);

  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline mpmath ${baselineParsed?.mpmath_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} (mp.dps=${
      baselineParsed?.mp_dps ?? '?'
    }) via Pyodide v${version}.`;

  enableRunner({
    slug: 'mpmath-983',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputBaselineEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
