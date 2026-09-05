import { pick } from '../_shared/i18n.js';
import {
  DEFAULT_PYODIDE_VERSION,
  totalEstimatedMB,
} from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const REPRO_CODE = `
import sqlite3
import sys

DROPPED = "   <-- setting dropped"

off = sqlite3.connect(":memory:", autocommit=False)
off.execute("PRAGMA foreign_keys = ON")
off.commit()

on = sqlite3.connect(":memory:", autocommit=True)
on.execute("PRAGMA foreign_keys = ON")

off_value = int(off.execute("PRAGMA foreign_keys").fetchone()[0])
on_value = int(on.execute("PRAGMA foreign_keys").fetchone()[0])
disagreement = off_value != on_value

result = {
    "python_version": sys.version.split()[0],
    "sqlite_version": sqlite3.sqlite_version,
    "off_autocommit_fk": off_value,
    "on_autocommit_fk": on_value,
    "fk_disagreement": disagreement,
}

off_note = DROPPED if off_value == 0 else ""
on_note = DROPPED if on_value == 0 else ""

print("Set PRAGMA foreign_keys = ON on two connections, then read it back:")
print()
print("autocommit".ljust(14) + "foreign_keys".rjust(14))
print("False".ljust(14) + str(off_value).rjust(14) + off_note)
print("True".ljust(14) + str(on_value).rjust(14) + on_note)
print()
if disagreement:
    print("The two connections disagree: autocommit=False dropped the PRAGMA.")
else:
    print("Both connections agree: the PRAGMA survived on both.")
print("Python " + result["python_version"] + " / SQLite " + result["sqlite_version"])
`.trim();

interface ReproOutput {
  python_version: string;
  sqlite_version: string;
  off_autocommit_fk: number;
  on_autocommit_fk: number;
  fk_disagreement: boolean;
}

type ProgressStage = 'init' | 'fetching-module' | 'loading-runtime' | 'ready';

interface WorkerProgress {
  type: 'progress';
  pct: number;
  stage: ProgressStage;
}

interface WorkerReady {
  type: 'ready';
  pyodideVersion: string;
}

interface WorkerRunResult {
  type: 'result';
  id: number;
  stdout: string;
  result: ReproOutput | null;
  error: string | null;
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

const WORKER_PACKAGES: string[] = [];
const ESTIMATED_MB = totalEstimatedMB(WORKER_PACKAGES.length);

const STRINGS: Record<ProgressStage, string> = {
  init: 'Starting Pyodide worker…',
  'fetching-module': 'Fetching Pyodide module…',
  'loading-runtime': 'Loading runtime + stdlib…',
  ready: 'Runtime ready.',
};

const STRINGS_JA: Partial<Record<ProgressStage, string>> = {
  init: 'Pyodide worker を起動中…',
  'fetching-module': 'Pyodide モジュールを取得中…',
  'loading-runtime': 'runtime と stdlib を読み込み中…',
  ready: 'runtime の準備完了。',
};

const S = pick(STRINGS, STRINGS_JA);

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'cpython-137205: missing required DOM elements (#output, #meta, #repro-code).',
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

function evaluate(result: ReproOutput | null): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (!result) {
    return {
      verdict: 'unreproduced',
      message: 'bug not reproduced — the script left no `result` mapping behind.',
    };
  }
  if (result.fk_disagreement) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — autocommit=False silently drops PRAGMA foreign_keys; the two connections disagree.',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — both connections agree on PRAGMA foreign_keys (likely fixed upstream).',
  };
}

function spawnWorker(): Worker {
  const workerUrl = new URL('./repro.worker.js', import.meta.url);
  workerUrl.searchParams.set('pyodide', DEFAULT_PYODIDE_VERSION);
  workerUrl.searchParams.set('packages', WORKER_PACKAGES.join(','));
  return new Worker(workerUrl, { type: 'module' });
}

function awaitReady(worker: Worker): Promise<WorkerReady> {
  return new Promise<WorkerReady>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onError = (ev: ErrorEvent): void => {
      cleanup();
      reject(new Error(ev.message));
    };
    const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        setVerdict('pending', S[msg.stage], 'loading');
        emitProgress(msg.pct, msg.stage);
        return;
      }
      if (msg.type === 'ready') {
        cleanup();
        resolve(msg);
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
}

let runId = 0;

function runInWorker(worker: Worker, source: string): Promise<WorkerRunResult> {
  const id = ++runId;
  return new Promise<WorkerRunResult>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onError = (ev: ErrorEvent): void => {
      cleanup();
      reject(new Error(ev.message));
    };
    const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
      const msg = ev.data;
      if (msg.type !== 'result' && msg.type !== 'error') return;
      if (msg.id !== id) return;
      cleanup();
      if (msg.type === 'result') resolve(msg);
      else reject(new Error(msg.message));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'run', id, source });
  });
}

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
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
  const ev = evaluate(result.result);
  return {
    run: {
      exitCode: result.result ? 0 : 1,
      verdict: ev.verdict,
      message: ev.message,
      stdout: result.stdout,
    },
    parsed: result.result,
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

try {
  setVerdict('pending', S.init, 'loading');
  emitProgress(5, 'init');

  const worker = spawnWorker();
  const ready = await awaitReady(worker);

  setVerdict('pending', 'Running reproduction script…', 'running');
  const baseline = await captureIn(worker, REPRO_CODE);
  outputEl.textContent = baseline.run.stdout;
  setVerdict(baseline.run.verdict, baseline.run.message);

  const baselineResult = baseline.parsed;
  if (!baselineResult) {
    throw new Error(baseline.run.message);
  }

  metaEl.textContent =
    `Python ${baselineResult.python_version} with stdlib sqlite3 ` +
    `(SQLite ${baselineResult.sqlite_version}) via Pyodide v${ready.pyodideVersion} ` +
    `(Web Worker).`;

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'cpython',
      issue: 137205,
      upstream_url: 'https://github.com/python/cpython/issues/137205',
    },
    runtime: {
      name: 'pyodide',
      version: ready.pyodideVersion,
      extras: {
        python: baselineResult.python_version,
        sqlite: baselineResult.sqlite_version,
      },
    },
    result: {
      off_autocommit_fk: baselineResult.off_autocommit_fk,
      on_autocommit_fk: baselineResult.on_autocommit_fk,
      fk_disagreement: baselineResult.fk_disagreement,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'cpython-137205',
    baselineSource: REPRO_CODE,
    runFix: async (source) => (await captureIn(worker, source)).run,
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
