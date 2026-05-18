// Vivarium Layer 1 reproduction — lark-parser/lark#1585.
//
// The grammar `start.1: "a" | start start*` causes an infinite
// loop in lark's LALR back-end when `parser='lalr'` is supplied.
// CYK exhibits the same hang; Earley terminates normally.
//
// Because the bug is a hang rather than a wrong result, the repro
// runs Pyodide + lark inside a Web Worker. The main thread races
// the worker's result message against a wall-clock budget and
// terminates the worker if it does not return within the budget —
// that termination is the verdict signal.
//
// Verdict semantics (per Contract v1) — applied to each variant
// pane individually; the top-level `#verdict` pill mirrors the
// **baseline** variant so the existing Contract v1 single-verdict
// surface (`__VIVARIUM_VERDICT__`, `data-verdict`) keeps its prior
// meaning and downstream consumers do not need to branch.
//   - "reproduced"   — the worker did not return within TIMEOUT_MS;
//                      the infinite loop is confirmed.
//   - "unreproduced" — the worker returned (parse completed; bug
//                      fixed upstream) or raised an exception (bug
//                      behaviour changed; the specific hang did
//                      not trigger) before the budget elapsed.
//
// The fix-candidate this page renders side-by-side is a pure-Python
// wheel under `./wheels/` built from the fork+branch
// `JamBalaya56562/lark@claude/fix-lark-1585-QLVa7` by
// `scripts/build-layer1-wheels.sh` (run by CI on PR merge and by
// `mise run repro:build:wheels` locally).

import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const TIMEOUT_MS = 8000;
const PYODIDE_VERSION = '0.29.3';
const BASELINE_SPEC = 'lark==1.3.1';

// Canonical reproduction source. The worker wraps it in a
// `try/except` + timing harness, but this is the part the recipe
// page surfaces in `<pre id="repro-code">` and the highlight-repros
// build step extracts. Editing this constant changes both the
// rendered source and the parse the worker actually runs.
const REPRO_CODE = `
Lark('start.1: "a" | start start*', parser='lalr').parse('aa')
`.trim();

interface ReproOutput {
  lark_version: string;
  python_version: string;
  outcome: 'returned' | 'raised';
  error: string | null;
  elapsed_ms: number;
}

interface WorkerReady {
  type: 'ready';
  pyodide_version: string;
  lark_version: string;
  python_version: string;
  variant: string;
}

interface WorkerProgress {
  type: 'progress';
  stage: string;
  variant: string;
}

interface WorkerResult {
  type: 'result';
  data: ReproOutput;
  variant: string;
}

interface WorkerError {
  type: 'error';
  message: string;
  variant?: string;
}

type WorkerMessage = WorkerReady | WorkerProgress | WorkerResult | WorkerError;

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

type Variant = 'baseline' | 'fix-candidate';

interface VariantOutcome {
  verdict: 'reproduced' | 'unreproduced';
  outcome: 'timeout' | ReproOutput['outcome'];
  larkVersion: string;
  pythonVersion: string;
  pyodideVersion: string;
  error: string | null;
  elapsedMs: number;
  message: string;
  stdout: string;
}

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'lark-1585: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
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

const startedAt = new Date();

let baseline: VariantOutcome | null = null;
let fixCandidate: VariantOutcome | null = null;
let manifest: WheelManifest | null = null;

function variantPaneEl(variant: Variant): HTMLElement {
  return variant === 'baseline' ? outputBaselineEl! : outputFixEl!;
}

async function runVariant(
  variant: Variant,
  spec: string,
  pendingLabel: string,
): Promise<VariantOutcome> {
  const paneEl = variantPaneEl(variant);
  if (variant === 'baseline') {
    setVerdict('pending', pendingLabel);
  }

  const workerUrl = new URL('./repro.worker.js', import.meta.url);
  workerUrl.searchParams.set('variant', variant);
  workerUrl.searchParams.set('spec', spec);
  const worker = new Worker(workerUrl, { type: 'module' });

  let ready: WorkerReady;
  try {
    ready = await new Promise<WorkerReady>((resolve, reject) => {
      const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          paneEl.textContent = `(worker: ${msg.stage}…)`;
          if (variant === 'baseline') {
            setVerdict('pending', `Worker: ${msg.stage}…`);
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
  } catch (err) {
    worker.terminate();
    const message = err instanceof Error ? err.message : String(err);
    paneEl.textContent = `worker bootstrap failed: ${message}`;
    return {
      verdict: 'unreproduced',
      outcome: 'raised',
      larkVersion: 'unknown',
      pythonVersion: 'unknown',
      pyodideVersion: PYODIDE_VERSION,
      error: message,
      elapsedMs: 0,
      message: `bug not reproduced — worker bootstrap failed: ${message}`,
      stdout: message,
    };
  }

  if (variant === 'baseline') {
    setVerdict(
      'pending',
      `Running Lark(...).parse('aa') with a ${TIMEOUT_MS / 1000}s budget…`,
    );
  }
  paneEl.textContent = `(running with a ${TIMEOUT_MS / 1000}s budget…)`;

  const resultPromise = new Promise<WorkerResult | WorkerError>(
    (resolve, reject) => {
      const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
        if (ev.data.type === 'result' || ev.data.type === 'error') {
          worker.removeEventListener('message', onMessage);
          resolve(ev.data);
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (ev) =>
        reject(new Error(`worker errored: ${ev.message}`)),
      );
    },
  );

  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), TIMEOUT_MS);
  });

  worker.postMessage({ type: 'go', source: REPRO_CODE });

  const outcome = await Promise.race([resultPromise, timeoutPromise]);

  if (outcome === 'timeout') {
    worker.terminate();
    const stdout = JSON.stringify(
      {
        lark_version: ready.lark_version,
        python_version: ready.python_version,
        outcome: 'timeout',
        timeout_ms: TIMEOUT_MS,
        reproduced: true,
      },
      null,
      2,
    );
    paneEl.textContent = stdout;
    return {
      verdict: 'reproduced',
      outcome: 'timeout',
      larkVersion: ready.lark_version,
      pythonVersion: ready.python_version,
      pyodideVersion: ready.pyodide_version,
      error: null,
      elapsedMs: TIMEOUT_MS,
      message:
        `bug reproduced — Lark('start.1: "a" | start start*', parser='lalr')` +
        `.parse('aa') did not return within ${TIMEOUT_MS / 1000}s; ` +
        `the LALR back-end is in an infinite loop.`,
      stdout,
    };
  }

  worker.terminate();

  if (outcome.type === 'error') {
    paneEl.textContent = outcome.message;
    return {
      verdict: 'unreproduced',
      outcome: 'raised',
      larkVersion: ready.lark_version,
      pythonVersion: ready.python_version,
      pyodideVersion: ready.pyodide_version,
      error: outcome.message,
      elapsedMs: 0,
      message: `bug not reproduced — worker errored before timeout: ${outcome.message}.`,
      stdout: outcome.message,
    };
  }

  const data = outcome.data;
  const stdout = JSON.stringify(data, null, 2);
  paneEl.textContent = stdout;
  const message =
    data.outcome === 'returned'
      ? `bug not reproduced — parse returned in ${data.elapsed_ms.toFixed(0)} ms (likely fixed upstream).`
      : `bug not reproduced — parse raised ${data.error ?? '<unknown>'} in ${data.elapsed_ms.toFixed(0)} ms; the specific infinite loop did not trigger.`;
  return {
    verdict: 'unreproduced',
    outcome: data.outcome,
    larkVersion: data.lark_version,
    pythonVersion: data.python_version,
    pyodideVersion: ready.pyodide_version,
    error: data.error,
    elapsedMs: data.elapsed_ms,
    message,
    stdout,
  };
}

function publishEnvelope(): void {
  if (!baseline) return;
  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'lark',
      issue: 1585,
      upstream_url: 'https://github.com/lark-parser/lark/issues/1585',
    },
    runtime: {
      name: 'pyodide',
      version: baseline.pyodideVersion,
      extras: {
        python: baseline.pythonVersion,
        lark: baseline.larkVersion,
        ...(fixCandidate
          ? { lark_fix_candidate: fixCandidate.larkVersion }
          : {}),
      },
    },
    result: {
      outcome: baseline.outcome,
      error: baseline.error,
      elapsed_ms: baseline.elapsedMs,
      timeout_ms: TIMEOUT_MS,
      reproduced: baseline.verdict === 'reproduced',
      baseline: {
        spec: BASELINE_SPEC,
        verdict: baseline.verdict,
        outcome: baseline.outcome,
        lark_version: baseline.larkVersion,
        elapsed_ms: baseline.elapsedMs,
        error: baseline.error,
      },
      fix_candidate:
        fixCandidate && manifest
          ? {
              spec:
                manifest.source.spec ??
                `lark @ git+${manifest.source.url}@${manifest.source.ref}` +
                  (manifest.source.subdirectory
                    ? `#subdirectory=${manifest.source.subdirectory}`
                    : ''),
              verdict: fixCandidate.verdict,
              outcome: fixCandidate.outcome,
              lark_version: fixCandidate.larkVersion,
              elapsed_ms: fixCandidate.elapsedMs,
              error: fixCandidate.error,
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
  setResult(envelope);
}

try {
  setVerdict('pending', 'Spawning Pyodide worker (baseline)…');

  baseline = await runVariant(
    'baseline',
    BASELINE_SPEC,
    'Spawning Pyodide worker (baseline)…',
  );

  metaEl.textContent =
    `Baseline lark ${baseline.larkVersion} on Python ${baseline.pythonVersion} ` +
    `via Pyodide v${baseline.pyodideVersion}; budget ${TIMEOUT_MS} ms.`;

  // Publish baseline-only envelope before flipping the top-level
  // pill — Playwright reads `__VIVARIUM_RESULT__` the moment
  // `data-verdict` leaves `pending`.
  publishEnvelope();

  // Top-level verdict pill mirrors baseline — preserves the
  // single-verdict Contract v1 surface for downstream consumers.
  setVerdict(baseline.verdict, baseline.message);

  // ---- Fix-candidate variant ----------------------------------------
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
      fixCandidate = await runVariant(
        'fix-candidate',
        wheelUrl,
        'Spawning Pyodide worker (fix-candidate)…',
      );
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      outputFixEl.textContent = `Fix-candidate run failed: ${message}`;
    }
  } else if (manifestRes && !manifestRes.ok) {
    outputFixEl.textContent = `Wheel manifest unavailable (HTTP ${manifestRes.status}).`;
  }

  // Re-publish the envelope now that the fix-candidate variant
  // has also captured (or definitively failed).
  publishEnvelope();
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
  if (!baseline) {
    publishEnvelope();
  }
}
