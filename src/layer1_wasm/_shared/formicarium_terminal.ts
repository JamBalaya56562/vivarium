export const ISOLATION_TIMEOUT_MS = 15_000;
export const FETCH_DEADLINE_MS = 120_000;
export const MAX_ELF_BYTES = 134_217_728;
export const MAX_METADATA_BYTES = 1_048_576;
export const MAX_CATALOG_BYTES = 4_194_304;
export const MAX_TRANSCRIPT_BYTES = 1_048_576;
export const MAX_TRANSCRIPT_LINES = 10_000;
export const FIXTURE_CWD = '/work/app';
export const TERMINAL_ELEMENT = 'formicarium-terminal';

export interface Assets {
  loaderURL: string;
  wasmURL: string;
  workerURL: string;
  buildInfoURL: string;
}

export type FsEntry =
  | { path: string; type: 'dir'; mode: number }
  | {
      path: string;
      type: 'file';
      mode: number;
      inodeId: string;
      data: Uint8Array;
    };

export interface GuestBuildInfo {
  tool: string;
  versionOrName: string;
  source: { repository: string; commit: string };
  buildKey: string;
  elfSha256: string;
  [key: string]: unknown;
}

export interface GuestHandle {
  readonly digest: string;
  readonly buildInfo: GuestBuildInfo;
}

export interface FormicariumSession {
  dispose(): Promise<void>;
}

export interface CommandResult {
  kind: string;
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface CommandSession {
  execute(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<CommandResult>;
}

export interface FormicariumApi {
  createSession(options: {
    assets: Assets;
    cwd: string;
    entries: readonly FsEntry[];
  }): Promise<FormicariumSession>;
  validateGuest(
    bytes: Uint8Array,
    expected: {
      elfSha256: string;
      buildInfoSha256: string;
      identity: GuestBuildInfo;
    },
  ): GuestHandle;
  registerValidatedGuest(
    session: FormicariumSession,
    tool: string,
    guest: GuestHandle,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  createCommandSession(
    session: FormicariumSession,
    options: { catalog: unknown },
  ): CommandSession;
  fixtureToFsEntries(entries: readonly FsEntry[]): readonly FsEntry[];
  decodeUtf8(bytes: Uint8Array): string;
}

export interface AssetsManifest {
  version: string;
  tarballSha256: string;
  entries: Record<
    'public' | 'browser' | 'worker' | 'loader' | 'wasm' | 'buildInfo',
    string
  >;
}

export interface LoadedFormicarium {
  api: FormicariumApi;
  assets: Assets;
  version: string;
  packSha256: string;
}

export interface AcceptedGuest {
  commit: string;
  versionOrName: string;
  buildKey: string;
  elfSha256: string;
  buildInfoSha256: string;
}

export interface RecipeGuest {
  role: 'baseline' | 'fix';
  tool: string;
  repository: string;
  commit: string;
  reference?: { branch?: string };
  accepted?: AcceptedGuest;
}

export interface FixtureFile {
  path: string;
  bytes: Uint8Array;
}

export interface ReadyDetail {
  tool: string;
  ref: string;
  commit: string;
  seconds: number;
}

export interface ExitDetail {
  command: string;
  code: number;
  output: string;
}

export type TerminalState =
  | 'connecting'
  | 'booting'
  | 'ready'
  | 'running'
  | 'failed'
  | 'disconnected';

export interface TerminalStrings {
  connecting: string;
  booting: string;
  ready: string;
  running: string;
  failed: string;
  disconnected: string;
  empty: string;
  progress: string;
  unknown: string;
  dropped: string;
  input: string;
}

export const DEFAULT_STRINGS: TerminalStrings = {
  connecting: 'Connecting…',
  booting: 'Starting the guest…',
  ready: 'Ready',
  running: 'Running…',
  failed: 'Failed',
  disconnected: 'Stopped',
  empty: '(no output)',
  progress: 'Downloaded {0} of {1} bytes',
  unknown: 'unknown',
  dropped: '{0} earlier bytes are no longer shown',
  input: 'Command',
};

export class TerminalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TerminalError';
    this.code = code;
  }
}

export type Mark = (name: string, detail?: Record<string, number>) => void;

export function recordMark(name: string, detail: Record<string, number> = {}) {
  const store = globalThis as {
    __VIVARIUM_FORMICARIUM_MARKS__?: {
      name: string;
      at: number;
      detail: Record<string, number>;
    }[];
  };
  store.__VIVARIUM_FORMICARIUM_MARKS__ ??= [];
  store.__VIVARIUM_FORMICARIUM_MARKS__.push({
    name,
    at: Math.round(performance.now()),
    detail,
  });
}

export async function waitForIsolation(
  options: {
    isolated?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    stepMs?: number;
  } = {},
): Promise<void> {
  const isolated =
    options.isolated ?? (() => globalThis.crossOriginIsolated === true);
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const timeoutMs = options.timeoutMs ?? ISOLATION_TIMEOUT_MS;
  const stepMs = options.stepMs ?? 250;
  for (let waited = 0; !isolated(); waited += stepMs) {
    if (waited >= timeoutMs)
      throw new TerminalError(
        'UNSUPPORTED_ENV',
        `the page is not cross-origin isolated after ${timeoutMs} ms`,
      );
    await sleep(stepMs);
  }
}

function relativeEntry(path: unknown, label: string): string {
  if (
    typeof path !== 'string' ||
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new TerminalError(
      'ASSET_LOAD',
      `assets.json ${label} is not a relative path`,
    );
  return path;
}

export function parseAssetsManifest(value: unknown): AssetsManifest {
  const record = value as Partial<AssetsManifest> | null;
  if (
    typeof record !== 'object' ||
    record === null ||
    typeof record.version !== 'string' ||
    typeof record.tarballSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.tarballSha256) ||
    typeof record.entries !== 'object' ||
    record.entries === null
  )
    throw new TerminalError('ASSET_LOAD', 'assets.json is malformed');
  const names = [
    'public',
    'browser',
    'worker',
    'loader',
    'wasm',
    'buildInfo',
  ] as const;
  const entries = {} as AssetsManifest['entries'];
  for (const name of names)
    entries[name] = relativeEntry(record.entries[name], name);
  return {
    version: record.version,
    tarballSha256: record.tarballSha256,
    entries,
  };
}

export async function loadFormicarium(options: {
  pageURL: string;
  fetch?: typeof fetch;
  importModule?: (url: string) => Promise<unknown>;
}): Promise<LoadedFormicarium> {
  const doFetch = options.fetch ?? fetch;
  const importModule =
    options.importModule ?? ((url: string) => import(/* @vite-ignore */ url));
  const root = new URL('./_formicarium/', options.pageURL);
  const response = await doFetch(new URL('assets.json', root).href, {
    credentials: 'omit',
  });
  if (!response.ok)
    throw new TerminalError(
      'ASSET_LOAD',
      `assets.json returned HTTP ${response.status}`,
    );
  const manifest = parseAssetsManifest(await response.json());
  const url = (name: keyof AssetsManifest['entries']) => {
    const resolved = new URL(manifest.entries[name], root).href;
    // A scheme such as data: passes the path check but leaves _formicarium/.
    if (!resolved.startsWith(root.href))
      throw new TerminalError(
        'ASSET_LOAD',
        `assets.json ${name} is not under _formicarium/`,
      );
    return resolved;
  };
  const [publicModule, browserModule] = await Promise.all([
    importModule(url('public')),
    importModule(url('browser')),
  ]);
  const api = {
    ...(publicModule as object),
    ...(browserModule as object),
  } as FormicariumApi;
  for (const name of [
    'createSession',
    'validateGuest',
    'registerValidatedGuest',
    'createCommandSession',
    'fixtureToFsEntries',
    'decodeUtf8',
  ] as const)
    if (typeof api[name] !== 'function')
      throw new TerminalError('ASSET_LOAD', `formicarium has no ${name}`);
  return {
    api,
    assets: {
      loaderURL: url('loader'),
      wasmURL: url('wasm'),
      workerURL: url('worker'),
      buildInfoURL: url('buildInfo'),
    },
    version: manifest.version,
    packSha256: manifest.tarballSha256,
  };
}

export function fixtureEntries(files: readonly FixtureFile[]): FsEntry[] {
  const entries: FsEntry[] = [{ path: FIXTURE_CWD, type: 'dir', mode: 0o755 }];
  for (const file of files)
    entries.push({
      path: `${FIXTURE_CWD}/${file.path}`,
      type: 'file',
      mode: 0o644,
      inodeId: `fixture:${file.path}`,
      data: file.bytes,
    });
  return entries;
}

const encoder = new TextEncoder();

export class TranscriptBuffer {
  #text = '';
  #bytes = 0;
  #lines = 0;
  droppedBytes = 0;

  constructor(
    readonly maxBytes = MAX_TRANSCRIPT_BYTES,
    readonly maxLines = MAX_TRANSCRIPT_LINES,
  ) {}

  get text(): string {
    return this.#text;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get lines(): number {
    return this.#lines;
  }

  append(chunk: string): void {
    this.#text += chunk;
    this.#bytes += encoder.encode(chunk).length;
    this.#lines = countLines(this.#text);
    while (this.#lines > this.maxLines) {
      const cut = this.#text.indexOf('\n') + 1;
      this.#drop(cut);
    }
    if (this.#bytes > this.maxBytes) {
      const bytes = encoder.encode(this.#text);
      let start = this.#bytes - this.maxBytes;
      while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80)
        start += 1;
      const kept = new TextDecoder().decode(bytes.subarray(start));
      this.droppedBytes += start;
      this.#text = kept;
      this.#bytes = bytes.length - start;
      this.#lines = countLines(kept);
    }
  }

  #drop(chars: number): void {
    const dropped = this.#text.slice(0, chars);
    const size = encoder.encode(dropped).length;
    this.droppedBytes += size;
    this.#bytes -= size;
    this.#text = this.#text.slice(chars);
    this.#lines = countLines(this.#text);
  }
}

function countLines(text: string): number {
  if (text === '') return 0;
  let lines = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1))
    lines += 1;
  return text.endsWith('\n') ? lines : lines + 1;
}

export function format(template: string, ...values: (string | number)[]) {
  return values.reduce<string>(
    (out, value, index) => out.replaceAll(`{${index}}`, String(value)),
    template,
  );
}

export function progressText(
  strings: TerminalStrings,
  processed: number,
  total: number | null,
): string {
  return format(
    strings.progress,
    processed,
    total === null ? strings.unknown : total,
  );
}

export async function fetchBytes(options: {
  fetch: typeof fetch;
  url: string;
  limitBytes: number;
  signal: AbortSignal;
  onProgress?: (processed: number, total: number | null) => void;
}): Promise<Uint8Array> {
  const doFetch = options.fetch;
  const response = await doFetch(options.url, {
    credentials: 'omit',
    signal: options.signal,
  });
  if (!response.ok)
    throw new TerminalError(
      'ASSET_LOAD',
      `${options.url} returned HTTP ${response.status}`,
    );
  const header = response.headers.get('content-length');
  const declared =
    header !== null && /^\d+$/.test(header) ? Number(header) : null;
  const total =
    declared !== null && declared <= options.limitBytes ? declared : null;
  options.onProgress?.(0, total);
  const chunks: Uint8Array[] = [];
  let processed = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    processed += value.byteLength;
    if (processed > options.limitBytes) {
      await reader.cancel();
      throw new TerminalError(
        'LIMIT_EXCEEDED',
        `${options.url} is larger than ${options.limitBytes} bytes`,
      );
    }
    chunks.push(value);
    options.onProgress?.(processed, total);
  }
  const out = new Uint8Array(processed);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export interface TerminalView {
  setState(state: TerminalState, text: string): void;
  setTranscript(text: string, notice: string): void;
  setProgress(text: string): void;
  setInputEnabled(enabled: boolean): void;
}

export interface TerminalOptions {
  loaded: LoadedFormicarium;
  guest: RecipeGuest;
  accepted: AcceptedGuest;
  guestURL: string;
  binary: string;
  fixture: readonly FixtureFile[];
  view: TerminalView;
  strings?: TerminalStrings;
  fetch?: typeof fetch;
  mark?: Mark;
  now?: () => number;
  timeoutSignal?: (ms: number) => AbortSignal;
}

export class TerminalController {
  readonly ready: Promise<ReadyDetail>;
  readonly #options: TerminalOptions;
  readonly #strings: TerminalStrings;
  readonly #abort = new AbortController();
  readonly #buffer = new TranscriptBuffer();
  #state: TerminalState = 'connecting';
  #session: FormicariumSession | null = null;
  #commands: CommandSession | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #inputAllowed = false;
  #resolveReady!: (detail: ReadyDetail) => void;
  #rejectReady!: (error: Error) => void;

  constructor(options: TerminalOptions) {
    this.#options = options;
    this.#strings = options.strings ?? DEFAULT_STRINGS;
    this.ready = new Promise<ReadyDetail>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.ready.catch(() => undefined);
    this.#setState('connecting');
    options.view.setInputEnabled(false);
  }

  get state(): TerminalState {
    return this.#state;
  }

  get transcript(): string {
    return this.#buffer.text;
  }

  #setState(state: TerminalState, detail = ''): void {
    this.#state = state;
    const label = this.#strings[state];
    this.#options.view.setState(state, detail ? `${label}: ${detail}` : label);
  }

  #live(): void {
    if (this.#abort.signal.aborted)
      throw new TerminalError('ABORTED', 'the terminal was removed');
  }

  async boot(): Promise<ReadyDetail> {
    const { loaded, guest, accepted, view } = this.#options;
    const doFetch = this.#options.fetch ?? fetch;
    const mark = this.#options.mark ?? recordMark;
    const now = this.#options.now ?? (() => performance.now());
    const timeoutSignal =
      this.#options.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
    const started = now();
    const role = guest.role;
    try {
      this.#setState('booting');
      const get = (name: string, limitBytes: number) =>
        fetchBytes({
          fetch: doFetch,
          url: new URL(name, this.#options.guestURL).href,
          limitBytes,
          signal: AbortSignal.any([
            this.#abort.signal,
            timeoutSignal(FETCH_DEADLINE_MS),
          ]),
          onProgress: (processed, total) =>
            view.setProgress(progressText(this.#strings, processed, total)),
        });
      mark(`fetch.${role}.start`);
      const infoBytes = await get('build-info.json', MAX_METADATA_BYTES);
      const catalogBytes = await get('catalog.json', MAX_CATALOG_BYTES);
      const elf = await get(this.#options.binary, MAX_ELF_BYTES);
      mark(`fetch.${role}.end`, { bytes: elf.byteLength });
      this.#live();
      mark(`verify.${role}.start`);
      const identity = JSON.parse(
        loaded.api.decodeUtf8(infoBytes),
      ) as GuestBuildInfo;
      if (
        identity.tool !== guest.tool ||
        identity.source?.repository !== guest.repository ||
        identity.source?.commit !== accepted.commit ||
        identity.buildKey !== accepted.buildKey
      )
        throw new TerminalError(
          'VERIFY_FAILED',
          `build-info is not the accepted ${guest.tool} ${accepted.commit} (${accepted.buildKey})`,
        );
      const handle = loaded.api.validateGuest(elf, {
        elfSha256: accepted.elfSha256,
        buildInfoSha256: accepted.buildInfoSha256,
        identity,
      });
      const session = await loaded.api.createSession({
        assets: loaded.assets,
        cwd: FIXTURE_CWD,
        entries: loaded.api.fixtureToFsEntries(
          fixtureEntries(this.#options.fixture),
        ),
      });
      this.#session = session;
      this.#live();
      await loaded.api.registerValidatedGuest(session, guest.tool, handle, {
        signal: this.#abort.signal,
      });
      this.#live();
      this.#commands = loaded.api.createCommandSession(session, {
        catalog: JSON.parse(loaded.api.decodeUtf8(catalogBytes)),
      });
      mark(`verify.${role}.end`);
      const detail: ReadyDetail = {
        tool: guest.tool,
        ref: guest.reference?.branch ?? '',
        commit: identity.source.commit,
        seconds: Math.round(now() - started) / 1000,
      };
      this.#setState('ready');
      mark(`ready.${role}`);
      this.#resolveReady(detail);
      return detail;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      // A session made before the failure is not reachable by run(); free it.
      const session = this.#session;
      this.#session = null;
      if (session) await session.dispose().catch(() => undefined);
      if (this.#abort.signal.aborted) {
        this.#rejectReady(
          new TerminalError('ABORTED', 'the terminal was removed'),
        );
      } else {
        this.#setState('failed', failure.message);
        this.#rejectReady(failure);
      }
      throw failure;
    }
  }

  run(command: string): Promise<ExitDetail> {
    const task = this.#queue.then(() => this.#runNow(command));
    this.#queue = task.catch(() => undefined);
    return task;
  }

  async #runNow(command: string): Promise<ExitDetail> {
    await this.ready;
    this.#live();
    const commands = this.#commands as CommandSession;
    this.#setState('running');
    this.#options.view.setInputEnabled(false);
    try {
      const result = await commands.execute(command, {
        signal: this.#abort.signal,
      });
      this.#live();
      const decode = this.#options.loaded.api.decodeUtf8;
      const output = decode(result.stdout) + decode(result.stderr);
      this.#append(
        `$ ${command}\n${output === '' ? `${this.#strings.empty}\n` : output.endsWith('\n') ? output : `${output}\n`}`,
      );
      return { command, code: result.exitCode, output };
    } finally {
      if (!this.#abort.signal.aborted) {
        this.#setState('ready');
        this.#options.view.setInputEnabled(this.#inputAllowed);
      }
    }
  }

  #append(text: string): void {
    this.#buffer.append(text);
    const dropped = this.#buffer.droppedBytes;
    this.#options.view.setTranscript(
      this.#buffer.text,
      dropped > 0 ? format(this.#strings.dropped, dropped) : '',
    );
  }

  enableInput(): void {
    this.#inputAllowed = true;
    if (this.#state === 'ready') this.#options.view.setInputEnabled(true);
  }

  async dispose(): Promise<void> {
    if (this.#abort.signal.aborted) return;
    this.#abort.abort(new TerminalError('ABORTED', 'the terminal was removed'));
    this.#rejectReady(new TerminalError('ABORTED', 'the terminal was removed'));
    this.#setState('disconnected');
    this.#options.view.setInputEnabled(false);
    const session = this.#session;
    this.#session = null;
    this.#commands = null;
    if (session) await session.dispose();
  }
}
