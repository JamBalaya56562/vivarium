// Web Worker for lark-1585. Runs Pyodide + lark in a separate
// thread so the main page can `worker.terminate()` if the parse hangs
// (the bug being reproduced is an infinite loop in lark's LALR
// back-end, which would otherwise freeze the tab).
//
// Protocol (all messages are JSON):
//   worker → main:
//     { type: 'progress', stage: string }
//     { type: 'ready', pyodide_version, lark_version, python_version, variant }
//     { type: 'result', data: ReproOutput, variant }
//     { type: 'error', message: string, variant? }
//   main → worker:
//     { type: 'go', source: string }
//
// The worker loads Pyodide and installs lark up-front, then waits
// for a `go` message before invoking the grammar. The main thread
// races the `result` message against a wall-clock timeout — if the
// timeout fires first, the worker is terminated and the verdict is
// "reproduced".
//
// The lark install spec is read from the worker URL's query string
// (`?spec=...&variant=...`) so the main thread can spawn one worker
// per variant: baseline (`lark==1.3.1`) and fix-candidate (the wheel
// built from `fix-candidate.json` and dropped under `./wheels/`).

// The project tsconfig pulls in `lib: DOM`, so we cannot `declare const
// self: DedicatedWorkerGlobalScope` here — that would collide with the
// DOM lib's `self: Window`. Cast at point of use instead: both `Window`
// and `DedicatedWorkerGlobalScope` expose `postMessage` /
// `addEventListener`, so the runtime call shape is the same.
const workerScope = self as unknown as {
  postMessage: (msg: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (ev: MessageEvent<{ type: string; source?: string }>) => void,
  ) => void;
  location: { href: string };
};

const PYODIDE_VERSION = '0.29.3';
const DEFAULT_LARK_SPEC = 'lark==1.3.1';

// Read per-variant configuration from the worker URL's query string.
// `new URL(self.location.href)` works in DedicatedWorkerGlobalScope
// even though TypeScript's DOM lib types it as `Window`-shaped.
const workerUrl = new URL(workerScope.location.href);
const VARIANT = workerUrl.searchParams.get('variant') ?? 'baseline';
const LARK_SPEC = workerUrl.searchParams.get('spec') ?? DEFAULT_LARK_SPEC;

interface ReproOutput {
  lark_version: string;
  python_version: string;
  outcome: 'returned' | 'raised';
  error: string | null;
  elapsed_ms: number;
}

interface PyodideModule {
  loadPyodide(opts: {
    indexURL: string;
    packages?: string[];
  }): Promise<PyodideRuntime>;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
}

// The actual reproduction source is shipped from the main thread
// via the `go` message — that keeps a single canonical declaration
// of REPRO_CODE in repro.ts where the highlight-repros build step
// can extract it for the recipe page.
const HARNESS_PROLOGUE = `
import json
import sys
import time
import lark
from lark import Lark

t0 = time.perf_counter()
outcome = "returned"
error_repr = None
try:
`.trim();

const HARNESS_EPILOGUE = `
except BaseException as e:
    outcome = "raised"
    error_repr = f"{type(e).__name__}: {e}"
elapsed_ms = (time.perf_counter() - t0) * 1000

json.dumps({
    "lark_version": lark.__version__,
    "python_version": sys.version.split()[0],
    "outcome": outcome,
    "error": error_repr,
    "elapsed_ms": elapsed_ms,
})
`.trim();

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

function progress(stage: string): void {
  workerScope.postMessage({ type: 'progress', stage, variant: VARIANT });
}

async function bootstrap(): Promise<{
  runtime: PyodideRuntime;
  larkVersion: string;
  pythonVersion: string;
}> {
  progress('downloading Pyodide runtime');
  const mod = (await import(
    /* @vite-ignore */ `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`
  )) as PyodideModule;

  const runtime = await mod.loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    packages: ['micropip'],
  });
  progress(`installing ${LARK_SPEC} via micropip`);
  await runtime.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(LARK_SPEC)})
`);

  const versionInfo = runtime.runPython(`
import json, sys, lark
json.dumps({"lark": lark.__version__, "python": sys.version.split()[0]})
`) as string;
  const parsed = JSON.parse(versionInfo) as { lark: string; python: string };
  return {
    runtime,
    larkVersion: parsed.lark,
    pythonVersion: parsed.python,
  };
}

async function runRepro(
  runtime: PyodideRuntime,
  source: string,
): Promise<ReproOutput> {
  const wrapped = `${HARNESS_PROLOGUE}\n${indent(source, 4)}\n${HARNESS_EPILOGUE}`;
  const raw = (await runtime.runPythonAsync(wrapped)) as string;
  return JSON.parse(raw) as ReproOutput;
}

let runtimeRef: PyodideRuntime | null = null;

workerScope.addEventListener(
  'message',
  (ev: MessageEvent<{ type: string; source?: string }>) => {
    if (ev.data?.type === 'go' && runtimeRef !== null && ev.data.source) {
      runRepro(runtimeRef, ev.data.source)
        .then((data) => {
          workerScope.postMessage({ type: 'result', data, variant: VARIANT });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          workerScope.postMessage({
            type: 'error',
            message,
            variant: VARIANT,
          });
        });
    }
  },
);

bootstrap()
  .then(({ runtime, larkVersion, pythonVersion }) => {
    runtimeRef = runtime;
    workerScope.postMessage({
      type: 'ready',
      pyodide_version: PYODIDE_VERSION,
      lark_version: larkVersion,
      python_version: pythonVersion,
      variant: VARIANT,
    });
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    workerScope.postMessage({
      type: 'error',
      message: `bootstrap failed: ${message}`,
      variant: VARIANT,
    });
  });
