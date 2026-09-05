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

STAMP = "2026-03-11 14:32:45"
CASES = [("UTC-4", -4), ("UTC+4", +4), ("UTC-04:00", -4), ("UTC+04:00", +4)]


def offset(seconds):
    sign = "-" if seconds < 0 else "+"
    return f"{sign}{abs(seconds) // 3600:02d}:{abs(seconds) % 3600 // 60:02d}"


results = []
for spec, expected_hours in CASES:
    expected = expected_hours * 3600
    actual = int(parse(f"{STAMP} {spec}").utcoffset().total_seconds())
    results.append(
        {
            "input": spec,
            "expected_offset_seconds": expected,
            "actual_offset_seconds": actual,
            "inverted": actual == -expected and actual != expected,
        }
    )

print(f"parse('{STAMP} <input>').utcoffset()")
print()
print(f"{'input':<12}{'expected':>10}{'actual':>10}")
for row in results:
    flag = "   <-- sign flipped" if row["inverted"] else ""
    print(
        f"{row['input']:<12}"
        f"{offset(row['expected_offset_seconds']):>10}"
        f"{offset(row['actual_offset_seconds']):>10}{flag}"
    )
print()
flipped = sum(row["inverted"] for row in results)
print(f"{flipped} of {len(results)} UTC-prefixed offsets came back negated.")
print(f"python-dateutil {dateutil.__version__} / Python {sys.version.split()[0]}")
`.trim();

interface CaseObservation {
  input: string;
  expected_offset_seconds: number;
  actual_offset_seconds: number;
  inverted: boolean;
}

interface ReproOutput {
  cases: CaseObservation[];
  inverted_count: number;
  case_count: number;
  reproduced: boolean;
}

interface RuntimeVersions {
  dateutil: string;
  python: string;
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

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
}

const BASELINE_SPEC = 'python-dateutil==2.9.0.post0';

const VERSION_QUERY =
  'import dateutil, sys; [dateutil.__version__, sys.version.split()[0]]';

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'dateutil-1478: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
  );
}

function setFixPane(text: string, status: 'pending' | 'ok' | 'error'): void {
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

function isPyProxy(value: unknown): value is PyProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PyProxy).toJs === 'function'
  );
}

function summarise(cases: CaseObservation[]): ReproOutput {
  const inverted = cases.filter((c) => c.inverted).length;
  return {
    cases,
    inverted_count: inverted,
    case_count: cases.length,
    reproduced: cases.length > 0 && inverted === cases.length,
  };
}

function readResults(runtime: PyodideRuntime): ReproOutput | null {
  const handle = runtime.globals.get('results');
  if (!isPyProxy(handle)) return null;
  try {
    const rows = handle.toJs({ dict_converter: Object.fromEntries });
    if (!Array.isArray(rows)) return null;
    return summarise(rows as CaseObservation[]);
  } finally {
    handle.destroy?.();
  }
}

async function readVersions(
  runtime: PyodideRuntime,
): Promise<RuntimeVersions | null> {
  const handle = await runtime.runPythonAsync(VERSION_QUERY);
  if (!isPyProxy(handle)) return null;
  try {
    const pair = handle.toJs({ dict_converter: Object.fromEntries });
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    return { dateutil: String(pair[0]), python: String(pair[1]) };
  } finally {
    handle.destroy?.();
  }
}

function evaluate(result: ReproOutput | null): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (!result) {
    return {
      verdict: 'unreproduced',
      message: 'bug not reproduced — the script left no `results` list behind.',
    };
  }
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
): Promise<CaptureResult> {
  const lines: string[] = [];
  runtime.setStdout({
    batched: (text) => {
      lines.push(text);
    },
  });
  // One Pyodide namespace spans every run: an edited script that never
  // assigns `results` would otherwise be judged on the previous run's list.
  if (runtime.globals.has('results')) runtime.globals.delete('results');
  try {
    await runtime.runPythonAsync(source);
    const parsed = readResults(runtime);
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
let baselineVersions: RuntimeVersions | null = null;
let fixCapture: PathACapturedRun | null = null;
let fixParsed: ReproOutput | null = null;
let fixVersions: RuntimeVersions | null = null;
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
  const baseline = await captureRun(runtime, REPRO_CODE);
  baselineCapture = baseline.run;
  baselineParsed = baseline.parsed;
  baselineVersions = await readVersions(runtime);
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
          python: baselineVersions?.python ?? '',
          'python-dateutil': baselineVersions?.dateutil ?? '',
          ...(fixParsed
            ? { 'python-dateutil_fix_candidate': fixVersions?.dateutil ?? '' }
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
          dateutil_version: baselineVersions?.dateutil ?? '',
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
                dateutil_version: fixVersions?.dateutil ?? '',
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
    `Baseline python-dateutil ${baselineVersions?.dateutil ?? '?'} on Python ` +
    `${baselineVersions?.python ?? '?'} via Pyodide v${version}.`;

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
      const fix = await captureRun(runtime, REPRO_CODE);
      fixCapture = fix.run;
      fixParsed = fix.parsed;
      fixVersions = await readVersions(runtime);
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
    runFix: async (source) => (await captureRun(runtime, source)).run,
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
