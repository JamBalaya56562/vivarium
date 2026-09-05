const workerScope = self as unknown as {
  postMessage: (msg: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (ev: MessageEvent<MainMessage>) => void,
  ) => void;
  location: { href: string };
};

interface MainMessage {
  type: 'run';
  id: number;
  source: string;
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

interface PyodideModule {
  loadPyodide(opts: {
    indexURL: string;
    packages?: string[];
  }): Promise<PyodideRuntime>;
}

const params = new URL(workerScope.location.href).searchParams;
const PYODIDE_VERSION = params.get('pyodide') ?? '';
const PACKAGES = (params.get('packages') ?? '').split(',').filter(Boolean);

function progress(pct: number, stage: string): void {
  workerScope.postMessage({ type: 'progress', pct, stage });
}

function fail(message: string, id?: number): void {
  workerScope.postMessage({ type: 'error', message, ...(id ? { id } : {}) });
}

function isPyProxy(value: unknown): value is PyProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PyProxy).toJs === 'function'
  );
}

function readResult(runtime: PyodideRuntime): unknown {
  const handle = runtime.globals.get('result');
  if (!isPyProxy(handle)) return null;
  try {
    return handle.toJs({ dict_converter: Object.fromEntries });
  } finally {
    handle.destroy?.();
  }
}

async function bootstrap(): Promise<PyodideRuntime> {
  progress(5, 'init');
  progress(18, 'fetching-module');
  const mod = (await import(
    /* @vite-ignore */ `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`
  )) as PyodideModule;

  progress(35, 'loading-runtime');
  const runtime = await mod.loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    packages: PACKAGES,
  });

  progress(92, 'ready');
  return runtime;
}

let runtimeRef: PyodideRuntime | null = null;

async function runOnce(
  runtime: PyodideRuntime,
  id: number,
  source: string,
): Promise<void> {
  const lines: string[] = [];
  runtime.setStdout({
    batched: (text) => {
      lines.push(text);
    },
  });
  // One Pyodide namespace spans every run: an edited script that never
  // assigns `result` would otherwise be judged on the previous run's values.
  if (runtime.globals.has('result')) runtime.globals.delete('result');

  try {
    await runtime.runPythonAsync(source);
    workerScope.postMessage({
      type: 'result',
      id,
      stdout: lines.join('\n'),
      result: readResult(runtime),
      error: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    workerScope.postMessage({
      type: 'result',
      id,
      stdout: [...lines, message].join('\n'),
      result: null,
      error: message,
    });
  }
}

workerScope.addEventListener('message', (ev: MessageEvent<MainMessage>) => {
  const msg = ev.data;
  if (msg?.type !== 'run') return;
  if (runtimeRef === null) {
    fail('worker received a run request before the runtime was ready.', msg.id);
    return;
  }
  void runOnce(runtimeRef, msg.id, msg.source);
});

if (!PYODIDE_VERSION) {
  fail(
    'worker URL is missing the `pyodide` query parameter; the main thread owns it.',
  );
} else {
  bootstrap()
    .then((runtime) => {
      runtimeRef = runtime;
      workerScope.postMessage({
        type: 'ready',
        pyodideVersion: PYODIDE_VERSION,
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      fail(`bootstrap failed: ${message}`);
    });
}

export {};
