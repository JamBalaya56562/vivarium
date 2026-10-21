import { describe, expect, test } from 'bun:test';
import {
  type AcceptedGuest,
  type CommandResult,
  DEFAULT_STRINGS,
  type FormicariumApi,
  fetchBytes,
  fixtureEntries,
  type LoadedFormicarium,
  loadFormicarium,
  MAX_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_LINES,
  progressText,
  type RecipeGuest,
  TerminalController,
  type TerminalOptions,
  type TerminalState,
  TranscriptBuffer,
  waitForIsolation,
} from '../formicarium_terminal.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const GUEST: RecipeGuest = {
  role: 'baseline',
  tool: 'biome',
  repository: 'https://github.com/biomejs/biome',
  commit: 'e'.repeat(40),
  reference: { branch: 'main' },
};
const ACCEPTED: AcceptedGuest = {
  commit: 'a'.repeat(40),
  versionOrName: 'a'.repeat(40),
  buildKey: 'b'.repeat(64),
  elfSha256: 'c'.repeat(64),
  buildInfoSha256: 'd'.repeat(64),
};
const BUILD_INFO = {
  tool: 'biome',
  versionOrName: ACCEPTED.versionOrName,
  source: { repository: GUEST.repository, commit: ACCEPTED.commit },
  buildKey: ACCEPTED.buildKey,
  elfSha256: ACCEPTED.elfSha256,
};

interface Recorded {
  states: TerminalState[];
  texts: string[];
  transcripts: string[];
  notices: string[];
  progress: string[];
  input: boolean[];
}

function view(): Recorded & TerminalOptions['view'] {
  const recorded: Recorded = {
    states: [],
    texts: [],
    transcripts: [],
    notices: [],
    progress: [],
    input: [],
  };
  return {
    ...recorded,
    setState(state, text) {
      recorded.states.push(state);
      recorded.texts.push(text);
    },
    setTranscript(text, notice) {
      recorded.transcripts.push(text);
      recorded.notices.push(notice);
    },
    setProgress(text) {
      recorded.progress.push(text);
    },
    setInputEnabled(enabled) {
      recorded.input.push(enabled);
    },
  };
}

function fakeApi(options: {
  execute?: (input: string) => Promise<CommandResult>;
  validate?: () => void;
}) {
  const calls: string[] = [];
  const api: FormicariumApi = {
    async createSession() {
      calls.push('createSession');
      return {
        async dispose() {
          calls.push('dispose');
        },
      };
    },
    validateGuest(bytes, expected) {
      calls.push(`validate:${decoder.decode(bytes)}:${expected.elfSha256}`);
      options.validate?.();
      return { digest: expected.elfSha256, buildInfo: expected.identity };
    },
    async registerValidatedGuest(_session, tool) {
      calls.push(`register:${tool}`);
    },
    createCommandSession() {
      calls.push('commandSession');
      return {
        execute: async (input) =>
          options.execute
            ? options.execute(input)
            : {
                kind: 'guest',
                exitCode: 0,
                stdout: encoder.encode(`${input}\n`),
                stderr: new Uint8Array(),
              },
      };
    },
    fixtureToFsEntries(entries) {
      calls.push(`fixture:${entries.length}`);
      return entries;
    },
    decodeUtf8: (bytes) => decoder.decode(bytes),
  };
  return { api, calls };
}

function loaded(api: FormicariumApi): LoadedFormicarium {
  return {
    api,
    assets: {
      loaderURL: 'https://x/l',
      wasmURL: 'https://x/w',
      workerURL: 'https://x/k',
      buildInfoURL: 'https://x/b',
    },
    version: '0.3.0',
    packSha256: 'f'.repeat(64),
  };
}

function guestFetch(
  overrides: Record<string, () => Response | Promise<Response>> = {},
) {
  const requested: { url: string; init?: RequestInit }[] = [];
  const files: Record<string, string> = {
    'build-info.json': JSON.stringify(BUILD_INFO),
    'catalog.json': '{"schemaVersion":1}',
    biome: 'ELF',
  };
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push({ url, ...(init ? { init } : {}) });
    const name = url.split('/').pop() as string;
    const override = overrides[name];
    if (override) return override();
    const body = files[name];
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body);
  }) as typeof fetch;
  return { fetcher, requested };
}

function controller(
  options: Partial<TerminalOptions> & {
    api: FormicariumApi;
    fetch: typeof fetch;
  },
) {
  const recorded = view();
  const terminal = new TerminalController({
    loaded: loaded(options.api),
    guest: GUEST,
    accepted: ACCEPTED,
    guestURL: 'https://site.test/repro/biome/x/guests/baseline/',
    binary: 'biome',
    fixture: [{ path: '.prettierrc', bytes: encoder.encode('{}') }],
    view: recorded,
    mark: () => undefined,
    timeoutSignal: () => new AbortController().signal,
    ...options,
  });
  return { terminal, recorded };
}

describe('TerminalController boot (BR3.2, BR3.3, BR3.6)', () => {
  test('verifies, registers and reports ReadyDetail from the build-info', async () => {
    const { api, calls } = fakeApi({});
    const { fetcher, requested } = guestFetch();
    const { terminal, recorded } = controller({ api, fetch: fetcher });
    const ready = await terminal.boot();
    expect(ready).toMatchObject({
      tool: 'biome',
      ref: 'main',
      commit: ACCEPTED.commit,
    });
    expect(calls).toEqual([
      `validate:ELF:${ACCEPTED.elfSha256}`,
      'fixture:2',
      'createSession',
      'register:biome',
      'commandSession',
    ]);
    expect(requested.map((r) => r.url.split('/').pop())).toEqual([
      'build-info.json',
      'catalog.json',
      'biome',
    ]);
    for (const r of requested) expect(r.init?.credentials).toBe('omit');
    expect(recorded.states).toEqual(['connecting', 'booting', 'ready']);
    expect(recorded.input.every((enabled) => !enabled)).toBe(true);
  });

  test('refuses a build-info that is not the accepted one and registers nothing', async () => {
    for (const changed of [
      { tool: 'other' },
      { buildKey: '0'.repeat(64) },
      { source: { repository: GUEST.repository, commit: '0'.repeat(40) } },
      {
        source: {
          repository: 'https://github.com/x/y',
          commit: ACCEPTED.commit,
        },
      },
    ]) {
      const { api, calls } = fakeApi({});
      const { fetcher } = guestFetch({
        'build-info.json': () =>
          new Response(JSON.stringify({ ...BUILD_INFO, ...changed })),
      });
      const { terminal, recorded } = controller({ api, fetch: fetcher });
      await expect(terminal.boot()).rejects.toThrow('not the accepted');
      await expect(terminal.ready).rejects.toThrow('not the accepted');
      expect(calls).toEqual([]);
      expect(recorded.states.at(-1)).toBe('failed');
      expect(recorded.texts.at(-1)).toContain('Failed: build-info is not');
    }
  });

  test('does not run an ELF that validateGuest rejects', async () => {
    const { api, calls } = fakeApi({
      validate: () => {
        throw new Error('ELF SHA256 does not match');
      },
    });
    const { terminal, recorded } = controller({
      api,
      fetch: guestFetch().fetcher,
    });
    await expect(terminal.boot()).rejects.toThrow('ELF SHA256');
    expect(calls).not.toContain('register:biome');
    expect(calls).not.toContain('createSession');
    expect(recorded.texts.at(-1)).toBe('Failed: ELF SHA256 does not match');
  });

  test('disposes the session when registering the guest fails', async () => {
    const { api, calls } = fakeApi({});
    api.registerValidatedGuest = async () => {
      throw new Error('register failed');
    };
    const { fetcher } = guestFetch();
    const { terminal } = controller({ api, fetch: fetcher });
    await expect(terminal.boot()).rejects.toThrow('register failed');
    expect(calls).toContain('dispose');
    await terminal.dispose();
    expect(calls.filter((call) => call === 'dispose')).toHaveLength(1);
  });

  test('fails on HTTP errors and on a response over its limit', async () => {
    const { api } = fakeApi({});
    const missing = controller({
      api,
      fetch: guestFetch({ biome: () => new Response('', { status: 404 }) })
        .fetcher,
    });
    await expect(missing.terminal.boot()).rejects.toThrow('HTTP 404');
    const big = controller({
      api,
      fetch: guestFetch({
        'build-info.json': () => new Response(new Uint8Array(1_048_577)),
      }).fetcher,
    });
    await expect(big.terminal.boot()).rejects.toThrow('larger than 1048576');
  });
});

describe('TerminalController runs (BR3.4, BR7.1)', () => {
  test('runs commands one at a time in the order they were called', async () => {
    const order: string[] = [];
    const { api } = fakeApi({
      execute: async (input) => {
        order.push(`start ${input}`);
        await new Promise((done) => setTimeout(done, input === 'a' ? 20 : 1));
        order.push(`end ${input}`);
        return {
          kind: 'guest',
          exitCode: input === 'b' ? 3 : 0,
          stdout: encoder.encode(input),
          stderr: encoder.encode(input === 'b' ? ' err' : ''),
        };
      },
    });
    const { terminal } = controller({ api, fetch: guestFetch().fetcher });
    const runs = [terminal.run('a'), terminal.run('b'), terminal.run('c')];
    void terminal.boot();
    const results = await Promise.all(runs);
    expect(order).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
    expect(results[1]).toEqual({ command: 'b', code: 3, output: 'b err' });
  });

  test('keeps input disabled until enableInput, and while a command runs', async () => {
    let open: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { api } = fakeApi({
      execute: async (input) => {
        if (input === 'ls') {
          started();
          await new Promise<void>((resolve) => {
            open = resolve;
          });
        }
        return {
          kind: 'guest',
          exitCode: 0,
          stdout: encoder.encode(input),
          stderr: new Uint8Array(),
        };
      },
    });
    const { terminal, recorded } = controller({
      api,
      fetch: guestFetch().fetcher,
    });
    await terminal.boot();
    await terminal.run('cat biome.json');
    expect(recorded.input.includes(true)).toBe(false);
    terminal.enableInput();
    expect(recorded.input.at(-1)).toBe(true);
    const run = terminal.run('ls');
    await running;
    expect(recorded.input.at(-1)).toBe(false);
    expect(terminal.state).toBe('running');
    open();
    await run;
    expect(recorded.input.at(-1)).toBe(true);
  });

  test('shows HTML symbols as text and marks empty output', async () => {
    const outputs: Record<string, string> = {
      html: '<img src=x onerror=alert(1)> & </pre>',
      empty: '',
    };
    const { api } = fakeApi({
      execute: async (input) => ({
        kind: 'guest',
        exitCode: 0,
        stdout: encoder.encode(outputs[input] ?? ''),
        stderr: new Uint8Array(),
      }),
    });
    const { terminal, recorded } = controller({
      api,
      fetch: guestFetch().fetcher,
    });
    await terminal.boot();
    await terminal.run('html');
    await terminal.run('empty');
    expect(terminal.transcript).toBe(
      `$ html\n<img src=x onerror=alert(1)> & </pre>\n$ empty\n${DEFAULT_STRINGS.empty}\n`,
    );
    expect(recorded.transcripts.at(-1)).toBe(terminal.transcript);
  });

  test('rejects a host failure and keeps the terminal usable', async () => {
    let fail = true;
    const { api } = fakeApi({
      execute: async (input) => {
        if (fail) {
          fail = false;
          throw new Error('EXECUTION core failed');
        }
        return {
          kind: 'guest',
          exitCode: 0,
          stdout: encoder.encode(input),
          stderr: new Uint8Array(),
        };
      },
    });
    const { terminal } = controller({ api, fetch: guestFetch().fetcher });
    await terminal.boot();
    await expect(terminal.run('x')).rejects.toThrow('EXECUTION core failed');
    expect(terminal.state).toBe('ready');
    expect((await terminal.run('y')).output).toBe('y');
  });
});

describe('TerminalController removal (P4, NFR4.2)', () => {
  test('aborts the fetch, drops the late response and disposes', async () => {
    const { api, calls } = fakeApi({});
    let release: (value: Response) => void = () => undefined;
    let aborted = false;
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      if (String(input).endsWith('/biome'))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return guestFetch().fetcher(input, init);
    }) as typeof fetch;
    const { terminal, recorded } = controller({ api, fetch: fetcher });
    const booting = terminal.boot();
    const pendingRun = terminal.run('late');
    await new Promise((done) => setTimeout(done, 5));
    await terminal.dispose();
    release(new Response('ELF'));
    await expect(booting).rejects.toThrow();
    await expect(terminal.ready).rejects.toThrow('removed');
    await expect(pendingRun).rejects.toThrow('removed');
    expect(aborted).toBe(true);
    expect(calls).not.toContain('register:biome');
    expect(recorded.states.at(-1)).toBe('disconnected');
    expect(recorded.transcripts).toEqual([]);
  });

  test('disposes the session of a ready terminal once', async () => {
    const { api, calls } = fakeApi({});
    const { terminal } = controller({ api, fetch: guestFetch().fetcher });
    await terminal.boot();
    await terminal.dispose();
    await terminal.dispose();
    expect(calls.filter((call) => call === 'dispose')).toHaveLength(1);
    await expect(terminal.run('x')).rejects.toThrow('removed');
  });
});

describe('TranscriptBuffer (BR3.5, C08 display limits)', () => {
  test('keeps 1048575 and 1048576 bytes and drops the start at 1048577', () => {
    expect(MAX_TRANSCRIPT_BYTES).toBe(1_048_576);
    for (const size of [1_048_575, 1_048_576]) {
      const buffer = new TranscriptBuffer();
      buffer.append('x'.repeat(size));
      expect([buffer.bytes, buffer.droppedBytes]).toEqual([size, 0]);
    }
    const buffer = new TranscriptBuffer();
    buffer.append(`é${'x'.repeat(1_048_575)}`);
    expect(buffer.bytes).toBe(1_048_575);
    expect(buffer.droppedBytes).toBe(2);
    expect(buffer.text.startsWith('x')).toBe(true);
  });

  test('keeps 9999 and 10000 lines and drops the first at 10001', () => {
    expect(MAX_TRANSCRIPT_LINES).toBe(10_000);
    for (const lines of [9_999, 10_000]) {
      const buffer = new TranscriptBuffer();
      buffer.append('l\n'.repeat(lines));
      expect(buffer.lines).toBe(lines);
    }
    const buffer = new TranscriptBuffer();
    buffer.append(`first\n${'l\n'.repeat(10_000)}`);
    expect(buffer.lines).toBe(10_000);
    expect(buffer.text.startsWith('first')).toBe(false);
    expect(buffer.droppedBytes).toBe(6);
  });

  test('reports dropped bytes to the view', async () => {
    const { api } = fakeApi({
      execute: async () => ({
        kind: 'guest',
        exitCode: 0,
        stdout: encoder.encode('y'.repeat(1_048_576)),
        stderr: new Uint8Array(),
      }),
    });
    const { terminal, recorded } = controller({
      api,
      fetch: guestFetch().fetcher,
    });
    await terminal.boot();
    await terminal.run('big');
    expect(recorded.notices.at(-1)).toMatch(
      /^\d+ earlier bytes are no longer shown$/,
    );
  });
});

describe('fetchBytes calls fetch unbound (regression: Illegal invocation)', () => {
  test('does not call fetch with the options object as this', async () => {
    const strict = function (this: unknown) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Failed to execute 'fetch': Illegal invocation");
      return Promise.resolve(new Response('ok'));
    } as unknown as typeof fetch;
    const bytes = await fetchBytes({
      fetch: strict,
      url: 'https://x/ok',
      limitBytes: 10,
      signal: new AbortController().signal,
    });
    expect(decoder.decode(bytes)).toBe('ok');
  });
});

describe('progress, isolation and loading (NFR7.3, BR3.1, S8)', () => {
  test('tells an unknown size from a zero-byte one', async () => {
    expect(progressText(DEFAULT_STRINGS, 0, null)).toBe(
      'Downloaded 0 of unknown bytes',
    );
    expect(progressText(DEFAULT_STRINGS, 0, 0)).toBe('Downloaded 0 of 0 bytes');
    const seen: [number, number | null][] = [];
    await fetchBytes({
      fetch: (async () =>
        new Response(new Uint8Array(0), {
          headers: { 'content-length': '0' },
        })) as unknown as typeof fetch,
      url: 'https://x/empty',
      limitBytes: 10,
      signal: new AbortController().signal,
      onProgress: (processed, total) => seen.push([processed, total]),
    });
    expect(seen).toEqual([[0, 0]]);
  });

  test('waits up to 15 s for isolation, then fails', async () => {
    let now = 0;
    const sleep = async (ms: number) => {
      now += ms;
    };
    await expect(
      waitForIsolation({ isolated: () => false, sleep }),
    ).rejects.toThrow('not cross-origin isolated after 15000 ms');
    expect(now).toBe(15_000);
    let calls = 0;
    const isolated = () => {
      calls += 1;
      return calls > 3;
    };
    await waitForIsolation({ isolated, sleep });
    expect(calls).toBe(4);
  });

  test('builds the formicarium URLs from the page itself, so the ja page uses its own copy', async () => {
    const manifest = {
      version: '0.3.0',
      tarballSha256: 'f'.repeat(64),
      entries: {
        public: '0.3.0/runtime/public.js',
        browser: '0.3.0/runtime/web/api.js',
        worker: '0.3.0/runtime/web/package-worker.bundle.js',
        loader: '0.3.0/assets/blink.mjs',
        wasm: '0.3.0/assets/blink.wasm',
        buildInfo: '0.3.0/assets/build-info.json',
      },
    };
    const { api } = fakeApi({});
    const imported: string[] = [];
    const page = 'https://site.test/vivarium/ja/repro/biome/x/';
    const result = await loadFormicarium({
      pageURL: page,
      fetch: (async (url: string) => {
        expect(url).toBe(`${page}_formicarium/assets.json`);
        return new Response(JSON.stringify(manifest));
      }) as unknown as typeof fetch,
      importModule: async (url) => {
        imported.push(url);
        return api;
      },
    });
    expect(result.assets.workerURL).toBe(
      `${page}_formicarium/0.3.0/runtime/web/package-worker.bundle.js`,
    );
    expect(imported).toEqual([
      `${page}_formicarium/0.3.0/runtime/public.js`,
      `${page}_formicarium/0.3.0/runtime/web/api.js`,
    ]);
    await expect(
      loadFormicarium({
        pageURL: page,
        fetch: (async () =>
          new Response(
            JSON.stringify({
              ...manifest,
              entries: { ...manifest.entries, worker: '../evil.js' },
            }),
          )) as unknown as typeof fetch,
        importModule: async () => api,
      }),
    ).rejects.toThrow('worker is not a relative path');
    // A scheme in the entry would make new URL() leave _formicarium/.
    const imports: string[] = [];
    await expect(
      loadFormicarium({
        pageURL: page,
        fetch: (async () =>
          new Response(
            JSON.stringify({
              ...manifest,
              entries: {
                ...manifest.entries,
                public: 'data:text/javascript,export%20default%201',
              },
            }),
          )) as unknown as typeof fetch,
        importModule: async (url) => {
          imports.push(url);
          return api;
        },
      }),
    ).rejects.toThrow('public is not under _formicarium/');
    expect(imports).toEqual([]);
  });

  test('lays the fixture out inside the cwd persistence root /work/app', () => {
    const entries = fixtureEntries([
      { path: 'biome.json', bytes: encoder.encode('{}') },
    ]);
    for (const entry of entries)
      expect(
        entry.path === '/work/app' || entry.path.startsWith('/work/app/'),
      ).toBe(true);
    expect(entries).toEqual([
      { path: '/work/app', type: 'dir', mode: 0o755 },
      {
        path: '/work/app/biome.json',
        type: 'file',
        mode: 0o644,
        inodeId: 'fixture:biome.json',
        data: encoder.encode('{}'),
      },
    ]);
  });
});
