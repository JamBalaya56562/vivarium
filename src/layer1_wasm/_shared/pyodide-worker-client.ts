import { pick } from './i18n.js';
import { DEFAULT_PYODIDE_VERSION, totalEstimatedMB } from './loader.js';
import { setVerdict } from './verdict.js';

export type ProgressStage =
  | 'init'
  | 'fetching-module'
  | 'loading-runtime'
  | 'installing-package'
  | 'ready';

export interface RunResult {
  stdout: string;
  value: unknown;
  error: string | null;
}

export interface PyodideWorker {
  pyodideVersion: string;
  run(source: string): Promise<RunResult>;
  evaluate(source: string): Promise<RunResult>;
  install(spec: string): Promise<RunResult>;
}

export interface StartOptions {
  packages?: string[];
  spec?: string;
  pipPackage?: string;
  rootModule?: string;
  resultGlobal?: string;
  runtimeLabel?: { en: string; ja: string };
  installLabel?: { en: string; ja: string };
}

interface WorkerProgress {
  type: 'progress';
  pct: number;
  stage: ProgressStage;
}

interface WorkerReady {
  type: 'ready';
  pyodideVersion: string;
}

interface WorkerResult {
  type: 'result';
  id: number;
  stdout: string;
  value: unknown;
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
  | WorkerResult
  | WorkerError;

function stageStrings(options: StartOptions): Record<ProgressStage, string> {
  const en: Record<ProgressStage, string> = {
    init: 'Starting Pyodide worker…',
    'fetching-module': 'Fetching Pyodide module…',
    'loading-runtime': options.runtimeLabel?.en ?? 'Loading runtime + stdlib…',
    'installing-package': options.installLabel?.en ?? 'Installing package…',
    ready: 'Runtime ready.',
  };
  const ja: Partial<Record<ProgressStage, string>> = {
    init: 'Pyodide worker を起動中…',
    'fetching-module': 'Pyodide モジュールを取得中…',
    'loading-runtime':
      options.runtimeLabel?.ja ?? 'runtime と stdlib を読み込み中…',
    'installing-package':
      options.installLabel?.ja ?? 'パッケージをインストール中…',
    ready: 'runtime の準備完了。',
  };
  return pick(en, ja);
}

function spawn(options: StartOptions): Worker {
  const url = new URL('./pyodide-worker.js', import.meta.url);
  url.searchParams.set('pyodide', DEFAULT_PYODIDE_VERSION);
  url.searchParams.set('packages', (options.packages ?? []).join(','));
  if (options.spec) url.searchParams.set('spec', options.spec);
  if (options.pipPackage) url.searchParams.set('pip', options.pipPackage);
  if (options.rootModule) url.searchParams.set('module', options.rootModule);
  if (options.resultGlobal) {
    url.searchParams.set('global', options.resultGlobal);
  }
  return new Worker(url, { type: 'module' });
}

export async function startPyodideWorker(
  options: StartOptions = {},
): Promise<PyodideWorker> {
  const strings = stageStrings(options);
  const estimatedMB = totalEstimatedMB((options.packages ?? []).length);

  const emit = (pct: number, stage: ProgressStage): void => {
    const loaded = stage === 'ready' ? estimatedMB : 0;
    document.dispatchEvent(
      new CustomEvent('vh-progress', {
        detail: {
          pct,
          label: strings[stage],
          bytes: `${loaded.toFixed(1)} MB / ${estimatedMB.toFixed(1)} MB`,
          stage: stage === 'ready' ? 'packages' : 'runtime',
        },
      }),
    );
  };

  setVerdict('pending', strings.init, 'loading');
  emit(5, 'init');

  const worker = spawn(options);

  const ready = await new Promise<WorkerReady>((resolve, reject) => {
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
        setVerdict('pending', strings[msg.stage], 'loading');
        emit(msg.pct, msg.stage);
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

  let nextId = 0;

  const request = (
    type: 'run' | 'eval' | 'install',
    payload: string,
  ): Promise<RunResult> => {
    const id = ++nextId;
    return new Promise<RunResult>((resolve) => {
      const cleanup = (): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const settle = (error: string): void => {
        cleanup();
        resolve({ stdout: error, value: null, error });
      };
      const onError = (ev: ErrorEvent): void => settle(ev.message);
      const onMessage = (ev: MessageEvent<WorkerMessage>): void => {
        const msg = ev.data;
        if (msg.type !== 'result' && msg.type !== 'error') return;
        if (msg.id !== id) return;
        if (msg.type === 'error') {
          settle(msg.message);
          return;
        }
        cleanup();
        resolve({ stdout: msg.stdout, value: msg.value, error: msg.error });
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const body = type === 'install' ? { spec: payload } : { source: payload };
      worker.postMessage({ type, id, ...body });
    });
  };

  return {
    pyodideVersion: ready.pyodideVersion,
    run: (source) => request('run', source),
    evaluate: (source) => request('eval', source),
    install: (spec) => request('install', spec),
  };
}
