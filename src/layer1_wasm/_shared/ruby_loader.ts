import { setVerdict } from "./verdict.js";
import { pick } from "./i18n.js";

const S = pick(
  { pending: 'Loading Ruby.wasm runtime…' },
  { pending: 'Ruby.wasm runtime を読み込み中…' },
);

export const DEFAULT_RUBY_WASM_VERSION = "2.10.1";

export const DEFAULT_RUBY_VERSION = "3.4";

export interface LoadOptions {
  rubyWasmVersion?: string;
  rubyVersion?: string;
  pendingText?: string;
}

export type RubyVMInstance = unknown;

export interface LoadResult {
  vm: RubyVMInstance;
  rubyWasmVersion: string;
  rubyVersion: string;
}

export async function loadVivariumRuby(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const rubyWasmVersion = options.rubyWasmVersion ?? DEFAULT_RUBY_WASM_VERSION;
  const rubyVersion = options.rubyVersion ?? DEFAULT_RUBY_VERSION;
  const pendingText = options.pendingText ?? S.pending;
  const total = 22.0; // ruby+stdlib.wasm is ~21 MB

  setVerdict("pending", pendingText, "loading");
  emitProgress(5, "Initialising…", `0.0 MB / ${total.toFixed(1)} MB`);

  const loaderUrl = `https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@${rubyWasmVersion}/dist/browser/+esm`;
  const wasmUrl = `https://cdn.jsdelivr.net/npm/@ruby/${rubyVersion}-wasm-wasi@${rubyWasmVersion}/dist/ruby+stdlib.wasm`;

  try {
    emitProgress(20, "Fetching Ruby.wasm loader…", `0.0 MB / ${total.toFixed(1)} MB`);
    const mod = (await import(/* @vite-ignore */ loaderUrl)) as {
      DefaultRubyVM: (
        module: WebAssembly.Module,
      ) => Promise<{ vm: RubyVMInstance }>;
    };

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
    const { vm } = await mod.DefaultRubyVM(wasmModule);

    emitProgress(94, "Runtime ready.", `${downloadedMB} MB / ${total.toFixed(1)} MB`);
    return { vm, rubyWasmVersion, rubyVersion };
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
