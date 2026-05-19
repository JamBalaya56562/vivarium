// Vivarium Layer 1 reproduction — dateutil/dateutil#1478.
//
// `dateutil.parser.parse` inverts the sign of a numeric UTC offset
// whenever the offset is preceded by the literal `UTC` prefix:
//
//   parse('2026-03-11 14:32:45 UTC-4').isoformat()
//     -> '2026-03-11T14:32:45+04:00'   (expected: -04:00)
//   parse('2026-03-11 14:32:45 UTC+4').isoformat()
//     -> '2026-03-11T14:32:45-04:00'   (expected: +04:00)
//
// Bare ISO 8601 forms (`+04:00` / `-04:00` without the `UTC`
// prefix) parse correctly, so the inversion is isolated to the
// `UTC` + signed-offset code path. python-dateutil is not in
// Pyodide's bundled package set; the page installs the pinned
// version via micropip.
//
// Verdict semantics (per ADR-0008 / contract v1) — applied to each
// variant card individually; the top-level `#verdict` pill mirrors
// the **baseline** variant so the existing Contract v1 single-verdict
// surface (`__VIVARIUM_VERDICT__`, `data-verdict`) keeps its prior
// meaning and downstream consumers do not need to branch.
//   - "reproduced"   — every UTC±N case lands on the negated offset
//                      (signed inversion present).
//   - "unreproduced" — at least one UTC±N case parsed with the
//                      correct sign (likely fixed upstream), or the
//                      runtime errored before producing a result.
//
// The fix-candidate this page renders side-by-side is a pure-Python
// wheel under `./wheels/` built from the fork+branch
// `JamBalaya56562/dateutil@fix-1478-utc-gmt-offset-sign`.

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
import dateutil
from dateutil.parser import parse

CASES = [
    ("UTC-4", -14400),
    ("UTC+4", +14400),
    ("UTC-04:00", -14400),
    ("UTC+04:00", +14400),
]

observations = []
for label, expected in CASES:
    dt = parse(f"2026-03-11 14:32:45 {label}")
    actual = int(dt.utcoffset().total_seconds())
    observations.append({
        "input": label,
        "expected_offset_seconds": expected,
        "actual_offset_seconds": actual,
        "inverted": actual == -expected and actual != expected,
    })

inversions = sum(1 for o in observations if o["inverted"])

{
    "dateutil_version": dateutil.__version__,
    "python_version": sys.version.split()[0],
    "cases": observations,
    "inverted_count": inversions,
    "case_count": len(CASES),
    "reproduced": inversions == len(CASES),
}
`.trim();

interface CaseObservation {
  input: string;
  expected_offset_seconds: number;
  actual_offset_seconds: number;
  inverted: boolean;
}

interface ReproOutput {
  dateutil_version: string;
  python_version: string;
  cases: CaseObservation[];
  inverted_count: number;
  case_count: number;
  reproduced: boolean;
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
    subdirectory?: string;
  };
  upstream_pr?: string;
  fetched_at?: string;
}

const BASELINE_SPEC = 'python-dateutil==2.9.0.post0';

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'dateutil-1478: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
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
        'bug reproduced — every "UTC±N" input parsed to its negated offset.',
    };
  }
  const correct = result.case_count - result.inverted_count;
  return {
    verdict: 'unreproduced',
    message: `bug not reproduced — ${correct}/${result.case_count} UTC±N cases parsed with the correct sign.`,
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

// Drop the in-memory dateutil module tree so the next `import
// dateutil` resolves the freshly-installed wheel rather than the
// previously-loaded version. Pyodide caches imports in
// `sys.modules`; `del` is the only reliable way to force a
// re-resolution after `micropip.uninstall`.
async function reinstallDateutil(
  runtime: PyodideRuntime,
  installSpec: string,
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall("python-dateutil")
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == "dateutil" or n.startswith("dateutil.")]:
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

  // Baseline variant: PyPI python-dateutil==2.9.0.post0.
  setVerdict('pending', `Installing ${BASELINE_SPEC} from PyPI…`);
  await reinstallDateutil(runtime, BASELINE_SPEC);

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
        project: 'dateutil',
        issue: 1478,
        upstream_url: 'https://github.com/dateutil/dateutil/issues/1478',
      },
      runtime: {
        name: 'pyodide',
        version,
        extras: {
          python: baselineParsed.python_version,
          'python-dateutil': baselineParsed.dateutil_version,
          ...(fixParsed
            ? { 'python-dateutil_fix_candidate': fixParsed.dateutil_version }
            : {}),
        },
      },
      result: {
        cases: baselineParsed.cases,
        inverted_count: baselineParsed.inverted_count,
        case_count: baselineParsed.case_count,
        reproduced: baselineParsed.reproduced,
        baseline: {
          spec: BASELINE_SPEC,
          verdict: baselineCapture.verdict,
          dateutil_version: baselineParsed.dateutil_version,
          cases: baselineParsed.cases,
          inverted_count: baselineParsed.inverted_count,
          case_count: baselineParsed.case_count,
          reproduced: baselineParsed.reproduced,
        },
        fix_candidate:
          fixParsed && fixCapture && manifest
            ? {
                spec:
                  manifest.source.spec ??
                  `python-dateutil @ git+${manifest.source.url}@${manifest.source.ref}` +
                    (manifest.source.subdirectory
                      ? `#subdirectory=${manifest.source.subdirectory}`
                      : ''),
                verdict: fixCapture.verdict,
                dateutil_version: fixParsed.dateutil_version,
                cases: fixParsed.cases,
                inverted_count: fixParsed.inverted_count,
                case_count: fixParsed.case_count,
                reproduced: fixParsed.reproduced,
                upstream_pr: manifest.upstream_pr || null,
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
  // pill — Playwright's regression suite reads `__VIVARIUM_RESULT__`
  // the moment `data-verdict` leaves `pending`.
  const initialEnvelope = buildEnvelope();
  if (initialEnvelope) setResult(initialEnvelope);

  // Top-level verdict pill mirrors baseline — preserves the
  // single-verdict Contract v1 surface for downstream consumers.
  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline python-dateutil ${baselineParsed?.dateutil_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} via Pyodide v${version}.`;

  // Fix-candidate variant: committed wheel.
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
      `from ${manifest.source.url}@${manifest.source.ref}` +
      (manifest.source.subdirectory
        ? ` (subdir: ${manifest.source.subdirectory})`
        : '');
    try {
      await reinstallDateutil(runtime, wheelUrl);
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

  // Restore baseline python-dateutil so the visitor-facing runner
  // (Edit + Run) operates against the buggy build — the runner's
  // documented mental model is "test your script change against the
  // same broken interpreter the recipe loaded". Without this,
  // runner.runFix would execute against the fix-candidate dateutil,
  // which is semantically surprising for visitors paste-editing the
  // script.
  try {
    await reinstallDateutil(runtime, BASELINE_SPEC);
  } catch {
    console.warn(
      'dateutil-1478: failed to restore baseline for the runner; runner.runFix will run against the fix-candidate.',
    );
  }

  // ---- Contract v1 envelope (final) ---------------------------------
  // Re-publish the envelope now that the fix-candidate variant has
  // also captured (or definitively failed). `result` keeps the
  // historical baseline-only fields (`cases`, `inverted_count`,
  // `reproduced`) so consumers reading
  // `__VIVARIUM_RESULT__.result.reproduced` continue to work, and the
  // additive `baseline` / `fix_candidate` sub-objects describe each
  // variant separately. Additive change — no `contract` version bump.
  const finalEnvelope = buildEnvelope();
  if (finalEnvelope) setResult(finalEnvelope);

  enableRunner({
    slug: 'dateutil-1478',
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
