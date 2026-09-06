const workerScope = self as unknown as {
  postMessage: (msg: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (ev: MessageEvent<MainMessage>) => void,
  ) => void;
  location: { href: string };
};

type MainMessage =
  | { type: 'run'; id: number; source: string }
  | { type: 'eval'; id: number; source: string }
  | { type: 'install'; id: number; spec: string };

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
const INSTALL_SPEC = params.get('spec') ?? '';
const PIP_PACKAGE = params.get('pip') ?? '';
const ROOT_MODULE = params.get('module') ?? '';
const RESULT_GLOBAL = params.get('global') ?? 'result';

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

function toJs(handle: unknown): unknown {
  // Pyodide converts int / float / str / bool / None on the way out, so a
  // scalar arrives here already converted and never as a proxy.
  if (!isPyProxy(handle)) return handle ?? null;
  try {
    return handle.toJs({ dict_converter: Object.fromEntries });
  } finally {
    handle.destroy?.();
  }
}

function installSource(spec: string): string {
  const lines = ['import micropip, sys'];
  if (PIP_PACKAGE) {
    lines.push(
      'try:',
      `    await micropip.uninstall(${JSON.stringify(PIP_PACKAGE)})`,
      'except Exception:',
      '    pass',
    );
  }
  if (ROOT_MODULE) {
    const prefix = JSON.stringify(`${ROOT_MODULE}.`);
    lines.push(
      `_stale = [n for n in list(sys.modules) if n == ${JSON.stringify(ROOT_MODULE)} or n.startswith(${prefix})]`,
      'for _name in _stale:',
      '    del sys.modules[_name]',
    );
  }
  lines.push(`await micropip.install(${JSON.stringify(spec)})`);
  return lines.join('\n');
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

  if (INSTALL_SPEC) {
    progress(70, 'installing-package');
    await runtime.runPythonAsync(installSource(INSTALL_SPEC));
  }

  progress(92, 'ready');
  return runtime;
}

let runtimeRef: PyodideRuntime | null = null;

function reply(
  id: number,
  stdout: string,
  value: unknown,
  error: string | null,
): void {
  workerScope.postMessage({ type: 'result', id, stdout, value, error });
}

async function capture(
  runtime: PyodideRuntime,
  id: number,
  source: string,
  read: (returned: unknown) => unknown,
): Promise<void> {
  const lines: string[] = [];
  runtime.setStdout({
    batched: (text) => {
      lines.push(text);
    },
  });

  try {
    const returned = await runtime.runPythonAsync(source);
    reply(id, lines.join('\n'), read(returned), null);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    reply(id, [...lines, message].join('\n'), null, message);
  }
}

function handle(runtime: PyodideRuntime, msg: MainMessage): void {
  if (msg.type === 'run') {
    // One Pyodide namespace spans every run: an edited script that never
    // assigns the global would otherwise be judged on the previous run's values.
    if (runtime.globals.has(RESULT_GLOBAL)) {
      runtime.globals.delete(RESULT_GLOBAL);
    }
    void capture(runtime, msg.id, msg.source, () =>
      toJs(runtime.globals.get(RESULT_GLOBAL)),
    );
    return;
  }
  if (msg.type === 'eval') {
    void capture(runtime, msg.id, msg.source, (returned) => toJs(returned));
    return;
  }
  void capture(runtime, msg.id, installSource(msg.spec), () => null);
}

workerScope.addEventListener('message', (ev: MessageEvent<MainMessage>) => {
  const msg = ev.data;
  if (msg?.type !== 'run' && msg?.type !== 'eval' && msg?.type !== 'install') {
    return;
  }
  if (runtimeRef === null) {
    fail('worker received a request before the runtime was ready.', msg.id);
    return;
  }
  handle(runtimeRef, msg);
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
