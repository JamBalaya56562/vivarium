import {
  fetchWheelManifest,
  resolveFixCandidateSpec,
  type WheelManifest,
} from '../_shared/fix-candidate.js';
import { pick } from '../_shared/i18n.js';
import { DEFAULT_PYODIDE_VERSION } from '../_shared/loader.js';
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

interface WorkerProgress {
  type: 'progress';
  pct: number;
  stage: ProgressStage;
}

interface WorkerReady {
  type: 'ready';
  pyodideVersion: string;
  dateutilVersion: string;
  pythonVersion: string;
}

interface WorkerRunResult {
  type: 'result';
  id: number;
  stdout: string;
  cases: CaseObservation[] | null;
  error: string | null;
  dateutilVersion: string;
  pythonVersion: string;
}

interface WorkerError {
  type: 'error';
  id?: number;
  message: string;
}

type WorkerMessage =
  | WorkerProgress
  | WorkerReady
  | WorkerRunResult
  | WorkerError;

type ProgressStage =
  | 'init'
  | 'fetching-module'
  | 'loading-runtime'
  | 'installing-package'
  | 'ready';

type Variant = 'baseline' | 'fix-candidate';

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
}

const BASELINE_SPEC = 'python-dateutil==2.9.0.post0';

// Mirrors the estimate _shared/loader.ts shows for a main-thread load, so the
// progress readout stays identical now that the load happens in a worker.
const ESTIMATED_MB = 12.6;

const STRINGS: Record<ProgressStage, string> = {
  init: 'Starting Pyodide worker…',
  'fetching-module': 'Fetching Pyodide module…',
  'loading-runtime': 'Loading runtime + stdlib…',
  'installing-package': 'Installing python-dateutil…',
  ready: 'Runtime ready.',
};

const STRINGS_JA: Partial<Record<ProgressStage, string>> = {
  init: 'Pyodide worker を起動中…',
  'fetching-module': 'Pyodide モジュールを取得中…',
  'loading-runtime': 'runtime と stdlib を読み込み中…',
  'installing-package': 'python-dateutil をインストール中…',
  ready: 'runtime の準備完了。',
};

const S = pick(STRINGS, STRINGS_JA);

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

function emitProgress(pct: number, stage: ProgressStage): void {
  const loaded = stage === 'ready' ? ESTIMATED_MB : 0;
  document.dispatchEvent(
    new CustomEvent('vh-progress', {
      detail: {
        pct,
        label: S[stage],
        bytes: `${loaded.toFixed(1)} MB / ${ESTIMATED_MB.toFixed(1)} MB`,
        stage: stage === 'ready' ? 'packages' : 'runtime',
      },
    }),
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

function spawnWorker(variant: Variant, spec: string): Worker {
  const workerUrl = new URL('./repro.worker.js', import.meta.url);
  workerUrl.searchParams.set('variant', variant);
  workerUrl.searchParams.set('spec', spec);
  workerUrl.searchParams.set('pyodide', DEFAULT_PYODIDE_VERSION);
  return new Worker(workerUrl, { type: 'module' });
}

function awaitReady(worker: Worker, variant: Variant): Promise<WorkerReady> {
  return new Promise<WorkerReady>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        if (variant === 'baseline') {
          setVerdict('pending', S[msg.stage], 'loading');
          emitProgress(msg.pct, msg.stage);
        }
      } else if (msg.type === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolve(msg);
      } else if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(msg.message));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (ev) => reject(new Error(ev.message)));
  });
}

let runId = 0;

function runInWorker(worker: Worker, source: string): Promise<WorkerRunResult> {
  const id = ++runId;
  return new Promise<WorkerRunResult>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
      const msg = ev.data;
      if (msg.type === 'result' && msg.id === id) {
        worker.removeEventListener('message', onMessage);
        resolve(msg);
      } else if (msg.type === 'error' && msg.id === id) {
        worker.removeEventListener('message', onMessage);
        reject(new Error(msg.message));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (ev) => reject(new Error(ev.message)));
    worker.postMessage({ type: 'run', id, source });
  });
}

function toCapture(result: WorkerRunResult): CaptureResult {
  if (result.error !== null) {
    return {
      run: {
        exitCode: 1,
        verdict: 'unreproduced',
        message: `runtime error: ${result.error}`,
        stdout: result.stdout,
      },
      parsed: null,
    };
  }
  const parsed = result.cases ? summarise(result.cases) : null;
  const ev = evaluate(parsed);
  return {
    run: {
      exitCode: parsed ? 0 : 1,
      verdict: ev.verdict,
      message: ev.message,
      stdout: result.stdout,
    },
    parsed,
  };
}

async function captureIn(
  worker: Worker,
  source: string,
): Promise<CaptureResult> {
  try {
    return toCapture(await runInWorker(worker, source));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      run: {
        exitCode: 1,
        verdict: 'unreproduced',
        message: `runtime error: ${message}`,
        stdout: message,
      },
      parsed: null,
    };
  }
}

const startedAt = new Date();

let baselineCapture: PathACapturedRun | null = null;
let baselineParsed: ReproOutput | null = null;
let baselineReady: WorkerReady | null = null;
let fixCapture: PathACapturedRun | null = null;
let fixParsed: ReproOutput | null = null;
let fixDateutilVersion = '';
let manifest: WheelManifest | null = null;

try {
  setVerdict('pending', S.init, 'loading');
  emitProgress(5, 'init');

  const baselineWorker = spawnWorker('baseline', BASELINE_SPEC);
  baselineReady = await awaitReady(baselineWorker, 'baseline');

  setVerdict('pending', 'Running reproduction script (baseline)…', 'running');
  const baseline = await captureIn(baselineWorker, REPRO_CODE);
  baselineCapture = baseline.run;
  baselineParsed = baseline.parsed;
  outputBaselineEl.textContent = baselineCapture.stdout;

  const buildEnvelope = (): VivariumResultV1 | null => {
    if (!baselineParsed || !baselineCapture || !baselineReady) return null;
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
        version: baselineReady.pyodideVersion,
        extras: {
          python: baselineReady.pythonVersion,
          'python-dateutil': baselineReady.dateutilVersion,
          ...(fixParsed
            ? { 'python-dateutil_fix_candidate': fixDateutilVersion }
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
          dateutil_version: baselineReady.dateutilVersion,
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
                dateutil_version: fixDateutilVersion,
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
    `Baseline python-dateutil ${baselineReady.dateutilVersion || '?'} on Python ` +
    `${baselineReady.pythonVersion || '?'} via Pyodide v${baselineReady.pyodideVersion} ` +
    `(Web Worker).`;

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
    const fixWorker = spawnWorker('fix-candidate', manifestResult.wheelUrl);
    try {
      const fixReady = await awaitReady(fixWorker, 'fix-candidate');
      const fix = await captureIn(fixWorker, REPRO_CODE);
      fixCapture = fix.run;
      fixParsed = fix.parsed;
      fixDateutilVersion = fixReady.dateutilVersion;
      setFixPane(fixCapture.stdout, 'ok');
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      setFixPane(`Fix-candidate install/run failed: ${message}`, 'error');
    } finally {
      fixWorker.terminate();
    }
  } else {
    setFixPane(manifestResult.reason, 'error');
  }

  const finalEnvelope = buildEnvelope();
  if (finalEnvelope) setResult(finalEnvelope);

  enableRunner({
    slug: 'dateutil-1478',
    baselineSource: REPRO_CODE,
    runFix: async (source) => (await captureIn(baselineWorker, source)).run,
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
