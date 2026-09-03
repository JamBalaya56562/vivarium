import {
  fetchWheelManifest,
  reinstallPyodidePackage,
  resolveFixCandidateSpec,
  type WheelManifest,
} from '../_shared/fix-candidate.js';
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

function setFixPane(
  text: string,
  status: 'pending' | 'ok' | 'error',
): void {
  outputFixEl!.textContent = text;
  outputFixEl!.dataset['fixStatus'] = status;
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

const reinstallDateutil = (
  runtime: PyodideRuntime,
  installSpec: string,
): Promise<void> =>
  reinstallPyodidePackage(runtime, {
    pipPackageName: 'python-dateutil',
    pythonRootModule: 'dateutil',
    installSpec,
  });

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
                spec: resolveFixCandidateSpec(manifest, 'python-dateutil'),
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

  const initialEnvelope = buildEnvelope();
  if (initialEnvelope) setResult(initialEnvelope);

  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline python-dateutil ${baselineParsed?.dateutil_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} via Pyodide v${version}.`;

  setFixPane('Fetching wheel manifest…', 'pending');
  const manifestResult = await fetchWheelManifest();

  if (manifestResult.ok) {
    manifest = manifestResult.manifest;
    setFixPane(
      `Installing ${manifest.filename} (${manifest.version})…\n` +
        `from ${manifest.source.url}@${manifest.source.ref}` +
        (manifest.source.subdirectory
          ? ` (subdir: ${manifest.source.subdirectory})`
          : ''),
      'pending',
    );
    try {
      await reinstallDateutil(runtime, manifestResult.wheelUrl);
      fixCapture = await captureRun(runtime, REPRO_CODE);
      try {
        fixParsed = JSON.parse(fixCapture.stdout) as ReproOutput;
      } catch {
        fixParsed = null;
      }
      setFixPane(fixCapture.stdout, 'ok');
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      setFixPane(`Fix-candidate install/run failed: ${message}`, 'error');
    }
  } else {
    setFixPane(manifestResult.reason, 'error');
  }

  try {
    await reinstallDateutil(runtime, BASELINE_SPEC);
  } catch {
    console.warn(
      'dateutil-1478: failed to restore baseline for the runner; runner.runFix will run against the fix-candidate.',
    );
  }

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
