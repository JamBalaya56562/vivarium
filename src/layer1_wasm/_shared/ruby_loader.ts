import { pick } from "./i18n.js";
import { setVerdict } from "./verdict.js";

const S = pick(
  { pending: 'Loading Ruby.wasm runtime…' },
  { pending: 'Ruby.wasm runtime を読み込み中…' },
);

export const DEFAULT_RUBY_WASM_VERSION = "2.10.1";

export const DEFAULT_RUBY_VERSION = "3.4";

export const DEFAULT_WASI_SHIM_VERSION = "0.4.2";

export interface LoadOptions {
  rubyWasmVersion?: string;
  rubyVersion?: string;
  wasiShimVersion?: string;
  pendingText?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  value: string | null;
  error: string | null;
}

export interface RubyRunner {
  eval(source: string): RunResult;
}

export interface LoadResult {
  ruby: RubyRunner;
  rubyWasmVersion: string;
  rubyVersion: string;
}

interface RubyPrinter {
  addToImports(imports: WebAssembly.Imports): void;
  setMemory(memory: WebAssembly.Memory): void;
}

interface RubyModule {
  RubyVM: {
    instantiateModule(opts: {
      module: WebAssembly.Module;
      wasip1: unknown;
      addToImports?: (imports: WebAssembly.Imports) => void;
      setMemory?: (memory: WebAssembly.Memory) => void;
    }): Promise<{ vm: { eval(code: string): { toString(): string } } }>;
  };
  consolePrinter(opts: {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }): RubyPrinter;
}

interface WasiShimModule {
  WASI: new (
    args: string[],
    env: string[],
    fds: unknown[],
    options?: { debug: boolean },
  ) => unknown;
  File: new (data: Uint8Array | number[]) => unknown;
  OpenFile: new (file: unknown) => unknown;
  PreopenDirectory: new (
    name: string,
    contents: Map<string, unknown>,
  ) => unknown;
}

export async function loadVivariumRuby(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const rubyWasmVersion = options.rubyWasmVersion ?? DEFAULT_RUBY_WASM_VERSION;
  const rubyVersion = options.rubyVersion ?? DEFAULT_RUBY_VERSION;
  const wasiShimVersion = options.wasiShimVersion ?? DEFAULT_WASI_SHIM_VERSION;
  const pendingText = options.pendingText ?? S.pending;
  const total = 22.0; // ruby+stdlib.wasm is ~21 MB

  setVerdict("pending", pendingText, "loading");
  emitProgress(5, "Initialising…", `0.0 MB / ${total.toFixed(1)} MB`);

  const rubyUrl = `https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@${rubyWasmVersion}/+esm`;
  const shimUrl = `https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@${wasiShimVersion}/dist/index.js`;
  const wasmUrl = `https://cdn.jsdelivr.net/npm/@ruby/${rubyVersion}-wasm-wasi@${rubyWasmVersion}/dist/ruby+stdlib.wasm`;

  try {
    emitProgress(20, "Fetching Ruby.wasm loader…", `0.0 MB / ${total.toFixed(1)} MB`);
    const [ruby, shim] = (await Promise.all([
      import(/* @vite-ignore */ rubyUrl),
      import(/* @vite-ignore */ shimUrl),
    ])) as [RubyModule, WasiShimModule];

    emitProgress(40, "Downloading ruby+stdlib.wasm…", `0.0 MB / ${total.toFixed(1)} MB`);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `failed to fetch ruby+stdlib.wasm (${response.status} ${response.statusText})`,
      );
    }
    const buffer = await response.arrayBuffer();
    const downloadedMB = (buffer.byteLength / 1_000_000).toFixed(1);

    emitProgress(70, "Compiling WebAssembly…", `${downloadedMB} MB / ${total.toFixed(1)} MB`);
    const wasmModule = await WebAssembly.compile(buffer);

    emitProgress(88, "Instantiating Ruby VM…", `${downloadedMB} MB / ${total.toFixed(1)} MB`);

    let stdout = "";
    let stderr = "";
    const printer = ruby.consolePrinter({
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    });

    const wasi = new shim.WASI(
      [],
      [],
      [
        new shim.OpenFile(new shim.File([])),
        new shim.OpenFile(new shim.File([])),
        new shim.OpenFile(new shim.File([])),
        new shim.PreopenDirectory("/", new Map()),
      ],
      { debug: false },
    );

    const { vm } = await ruby.RubyVM.instantiateModule({
      module: wasmModule,
      wasip1: wasi,
      addToImports: (imports) => printer.addToImports(imports),
      setMemory: (memory) => printer.setMemory(memory),
    });

    emitProgress(94, "Runtime ready.", `${downloadedMB} MB / ${total.toFixed(1)} MB`);
    return {
      ruby: {
        eval(source: string): RunResult {
          stdout = "";
          stderr = "";
          try {
            const value = vm.eval(source).toString();
            return { stdout, stderr, value, error: null };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { stdout, stderr, value: null, error: message };
          }
        },
      },
      rubyWasmVersion,
      rubyVersion,
    };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error during Ruby.wasm load: ${message}`,
    );
    throw err;
  }
}

function emitProgress(pct: number, label: string, bytes: string): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent("vh-progress", {
      detail: { pct, label, bytes, stage: "runtime" },
    }),
  );
}
