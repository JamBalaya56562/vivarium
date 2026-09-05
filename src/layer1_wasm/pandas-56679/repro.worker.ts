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
  let handle: unknown;
  try {
    handle = await runtime.runPythonAsync(source);
  } catch (err: unknown) {
    workerScope.postMessage({
      type: 'result',
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!isPyProxy(handle)) {
    workerScope.postMessage({
      type: 'result',
      id,
      result: null,
      error: 'the script did not end in a mapping the page could read.',
    });
    return;
  }

  try {
    const result = handle.toJs({ dict_converter: Object.fromEntries });
    workerScope.postMessage({ type: 'result', id, result, error: null });
  } catch (err: unknown) {
    workerScope.postMessage({
      type: 'result',
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    handle.destroy?.();
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
