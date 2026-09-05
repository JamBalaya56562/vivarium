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
  | { type: 'install'; id: number; spec: string };

export interface CaseObservation {
  input: string;
  expected_offset_seconds: number;
  actual_offset_seconds: number;
  inverted: boolean;
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

const PIP_PACKAGE = 'python-dateutil';
const ROOT_MODULE = 'dateutil';

const VERSION_QUERY =
  'import dateutil, sys; [dateutil.__version__, sys.version.split()[0]]';

const params = new URL(workerScope.location.href).searchParams;
const PYODIDE_VERSION = params.get('pyodide') ?? '';
const INSTALL_SPEC = params.get('spec') ?? '';
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

function readResults(runtime: PyodideRuntime): CaseObservation[] | null {
  const handle = runtime.globals.get('results');
  if (!isPyProxy(handle)) return null;
  try {
    const rows = handle.toJs({ dict_converter: Object.fromEntries });
    return Array.isArray(rows) ? (rows as CaseObservation[]) : null;
  } finally {
    handle.destroy?.();
  }
}

async function readVersions(
  runtime: PyodideRuntime,
): Promise<{ dateutil: string; python: string } | null> {
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

async function installSpec(
  runtime: PyodideRuntime,
  spec: string,
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall(${JSON.stringify(PIP_PACKAGE)})
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == ${JSON.stringify(ROOT_MODULE)} or n.startswith(${JSON.stringify(`${ROOT_MODULE}.`)})]:
    del sys.modules[_name]
await micropip.install(${JSON.stringify(spec)})
`);
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

  progress(70, 'installing-package');
  await installSpec(runtime, INSTALL_SPEC);

  progress(92, 'ready');
  return runtime;
}

let runtimeRef: PyodideRuntime | null = null;

async function runOnce(runtime: PyodideRuntime, id: number, source: string) {
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
    const cases = readResults(runtime);
    const versions = await readVersions(runtime);
    workerScope.postMessage({
      type: 'result',
      id,
      stdout: lines.join('\n'),
      cases,
      error: null,
      dateutilVersion: versions?.dateutil ?? '',
      pythonVersion: versions?.python ?? '',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    workerScope.postMessage({
      type: 'result',
      id,
      stdout: [...lines, message].join('\n'),
      cases: null,
      error: message,
      dateutilVersion: '',
      pythonVersion: '',
    });
  }
}

async function installOnce(
  runtime: PyodideRuntime,
  id: number,
  spec: string,
): Promise<void> {
  try {
    await installSpec(runtime, spec);
    const versions = await readVersions(runtime);
    workerScope.postMessage({
      type: 'installed',
      id,
      dateutilVersion: versions?.dateutil ?? '',
      pythonVersion: versions?.python ?? '',
    });
  } catch (err: unknown) {
    fail(err instanceof Error ? err.message : String(err), id);
  }
}

workerScope.addEventListener('message', (ev: MessageEvent<MainMessage>) => {
  const msg = ev.data;
  if (msg?.type !== 'run' && msg?.type !== 'install') return;
  if (runtimeRef === null) {
    fail('worker received a request before the runtime was ready.', msg.id);
    return;
  }
  if (msg.type === 'run') {
    void runOnce(runtimeRef, msg.id, msg.source);
  } else {
    void installOnce(runtimeRef, msg.id, msg.spec);
  }
});

if (!PYODIDE_VERSION || !INSTALL_SPEC) {
  fail(
    'worker URL is missing the `pyodide` or `spec` query parameter; the main thread owns both.',
  );
} else {
  bootstrap()
    .then(async (runtime) => {
      runtimeRef = runtime;
      const versions = await readVersions(runtime);
      workerScope.postMessage({
        type: 'ready',
        pyodideVersion: PYODIDE_VERSION,
        dateutilVersion: versions?.dateutil ?? '',
        pythonVersion: versions?.python ?? '',
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      fail(`bootstrap failed: ${message}`);
    });
}
