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
// The fix candidate this page renders side-by-side is the fork
// branch `JamBalaya56562/mpmath@claude/fix-mpmath-issue-983-y1k7X`
// — built into a pure-Python wheel under `./wheels/` and installed
// into the same Pyodide tab so visitors can compare the before/
// after verdict in one page load.
//
// Verdict semantics (per ADR-0008 / contract v1) — applied to each
// variant card individually; the top-level `#verdict` pill mirrors
// the **baseline** variant so the existing Contract v1 single-
// verdict surface (`__VIVARIUM_VERDICT__`, `data-verdict`) keeps
// its prior meaning and downstream consumers do not need to branch.
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

interface WheelManifest {
  schema_version: number;
  package: string;
  filename: string;
  version: string;
  source: {
    type: string;
    url: string;
    ref: string;
    commit?: string;
    spec?: string;
  };
  upstream_pr?: string;
  fetched_at?: string;
}

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'mpmath-983: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
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

// Re-shape the dict that came back through `pyodide.toJs(...)` so the
// stringified form is symmetric across the baseline and fix-candidate
// variants. Pyodide maps Python `None` to JS `undefined`, and
// `JSON.stringify` strips `undefined`-valued keys. Normalising here
// keeps both panels comparable at a glance.
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

// Drop the in-memory mpmath module tree so the next `import mpmath`
// resolves the freshly-installed wheel rather than the previously-loaded
// version. Pyodide caches imports in `sys.modules`; `del` is the only
// reliable way to force a re-resolution after `micropip.uninstall`.
async function reinstallMpmath(
  runtime: PyodideRuntime,
  installSpec: string,
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall("mpmath")
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == "mpmath" or n.startswith("mpmath.")]:
    del sys.modules[_name]
await micropip.install(${JSON.stringify(installSpec)})
`);
}

const startedAt = new Date();

let baselineCapture: PathACapturedRun | null = null;
let baselineParsed: ReproOutput | null = null;
let fixCapture: PathACapturedRun | null = null;
let fixParsed: ReproOutput | null = null;
let manifest: WheelManifest | null = null;

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });
  const runtime = pyodide as PyodideRuntime;

  // -------- Variant 1: baseline (PyPI mpmath==1.4.1) -----------------
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

  // Build the Contract v1 envelope as a closure that reflects whatever
  // variant data is currently captured. Called once after baseline (so
  // `__VIVARIUM_RESULT__` is populated by the time the top-level
  // `#verdict` pill flips to "reproduced" — Playwright reads the
  // envelope at that moment and would otherwise see `undefined`), and
  // again after the fix-candidate run completes so the envelope picks
  // up the second variant.
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
          ...(fixParsed
            ? { mpmath_fix_candidate: fixParsed.mpmath_version }
            : {}),
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
        fix_candidate:
          fixParsed && fixCapture && manifest
            ? {
                spec:
                  manifest.source.spec ??
                  `mpmath @ git+${manifest.source.url}@${manifest.source.ref}`,
                verdict: fixCapture.verdict,
                mpmath_version: fixParsed.mpmath_version,
                qr_solve_raised: fixParsed.qr_solve_raised,
                lu_solve_succeeded: fixParsed.lu_solve_succeeded,
                asymmetry: fixParsed.asymmetry,
                upstream_pr: manifest.upstream_pr ?? null,
              }
            : null,
      },
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      },
    };
  };

  // Publish the baseline-only envelope BEFORE flipping the verdict
  // pill — Playwright's regression suite reads
  // `__VIVARIUM_RESULT__` the moment `data-verdict` leaves `pending`.
  const initialEnvelope = buildEnvelope();
  if (initialEnvelope) setResult(initialEnvelope);

  // Top-level verdict pill mirrors baseline — preserves the
  // single-verdict Contract v1 surface for downstream consumers.
  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline mpmath ${baselineParsed?.mpmath_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} (mp.dps=${
      baselineParsed?.mp_dps ?? '?'
    }) via Pyodide v${version}.`;

  // -------- Variant 2: fix-candidate (committed wheel) ---------------
  outputFixEl.textContent = 'Fetching wheel manifest…';
  let manifestRes: Response | null = null;
  try {
    manifestRes = await fetch('./wheels/manifest.json', { cache: 'no-store' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputFixEl.textContent = `Could not fetch wheel manifest: ${message}`;
  }

  if (manifestRes && manifestRes.ok) {
    manifest = (await manifestRes.json()) as WheelManifest;
    const wheelUrl = new URL(
      `./wheels/${manifest.filename}`,
      window.location.href,
    ).toString();
    outputFixEl.textContent =
      `Installing ${manifest.filename} (${manifest.version})…\n` +
      `from ${manifest.source.url}@${manifest.source.ref}`;
    try {
      await reinstallMpmath(runtime, wheelUrl);
      fixCapture = await captureRun(runtime, REPRO_CODE);
      try {
        fixParsed = JSON.parse(fixCapture.stdout) as ReproOutput;
      } catch {
        fixParsed = null;
      }
      outputFixEl.textContent = fixCapture.stdout;
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      outputFixEl.textContent = `Fix-candidate install/run failed: ${message}`;
    }
  } else if (manifestRes && !manifestRes.ok) {
    outputFixEl.textContent = `Wheel manifest unavailable (HTTP ${manifestRes.status}).`;
  }

  // Restore baseline mpmath so the visitor-facing runner (Edit + Run)
  // operates against the buggy build — the runner's documented mental
  // model is "test your script change against the same broken
  // interpreter the recipe loaded". Without this, runner.runFix would
  // execute against the fix-candidate mpmath, which is semantically
  // surprising for visitors paste-editing the script.
  try {
    await reinstallMpmath(runtime, 'mpmath==1.4.1');
  } catch {
    console.warn(
      'mpmath-983: failed to restore baseline for the runner; runner.runFix will run against the fix-candidate.',
    );
  }

  // ---- Contract v1 envelope (final) ---------------------------------
  // Re-publish the envelope now that the fix-candidate variant has
  // also captured (or definitively failed). `result` keeps the
  // historical baseline-only fields so consumers reading
  // `__VIVARIUM_RESULT__.result.asymmetry` continue to work, and the
  // additive `baseline` / `fix_candidate` sub-objects describe each
  // variant separately. Additive change — no `contract` version bump.
  const finalEnvelope = buildEnvelope();
  if (finalEnvelope) setResult(finalEnvelope);

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
