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
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced"   — every UTC±N case lands on the negated offset
//                      (signed inversion present).
//   - "unreproduced" — at least one UTC±N case parsed with the
//                      correct sign (likely fixed upstream), or the
//                      runtime errored before producing a result.

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

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'dateutil-1478: missing required DOM elements (#output, #meta, #repro-code).',
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

const startedAt = new Date();

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });
  const runtime = pyodide as PyodideRuntime;

  setVerdict('pending', 'Installing python-dateutil==2.9.0.post0 from PyPI…');
  await runtime.runPythonAsync(`
import micropip
await micropip.install("python-dateutil==2.9.0.post0")
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
    `python-dateutil ${baselineResult.dateutil_version} on Python ` +
    `${baselineResult.python_version} via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
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
        python: baselineResult.python_version,
        'python-dateutil': baselineResult.dateutil_version,
      },
    },
    result: {
      cases: baselineResult.cases,
      inverted_count: baselineResult.inverted_count,
      case_count: baselineResult.case_count,
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
    slug: 'dateutil-1478',
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
