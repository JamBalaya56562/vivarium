// Vivarium contract v1 — Ruby.wasm loader.
//
// Loads `@ruby/wasm-wasi` from jsDelivr, fetches the matching
// `@ruby/<ruby-major-minor>-wasm-wasi` ruby+stdlib.wasm binary, and
// returns an instantiated RubyVM. On any load failure, the helper sets
// the verdict to "fail" with the error text and re-throws — mirroring
// `loader.ts` for Pyodide.
//
// Pages should still wrap their reproduction code in `try/catch` and
// call `setVerdict("fail", ...)` themselves on REPRODUCTION-time errors;
// this helper only owns load-time errors.

import { setVerdict } from "./verdict.js";

/** `@ruby/wasm-wasi` package version. Bumping requires updating the
 *  `<link rel="modulepreload">` in pages that preload this URL. */
export const DEFAULT_RUBY_WASM_VERSION = "2.8.1";

/** Ruby major.minor series shipped by the `@ruby/<X.Y>-wasm-wasi`
 *  binary package. */
export const DEFAULT_RUBY_VERSION = "3.3";

export interface LoadOptions {
  /** Override the `@ruby/wasm-wasi` package version. */
  rubyWasmVersion?: string;
  /** Override the Ruby major.minor series (e.g. "3.4"). */
  rubyVersion?: string;
  /** Verdict message shown while loading (default "Loading Ruby.wasm runtime…"). */
  pendingText?: string;
}

/**
 * Ruby VM handle. Typed as `unknown` for now because `@ruby/wasm-wasi`
 * does not publish browser-friendly type definitions; reproductions
 * cast or refine locally where they call `vm.eval(...)`.
 */
export type RubyVMInstance = unknown;

export interface LoadResult {
  vm: RubyVMInstance;
  /** Echoes `options.rubyWasmVersion` or the default. */
  rubyWasmVersion: string;
  /** Echoes `options.rubyVersion` or the default. */
  rubyVersion: string;
}

/**
 * Load Ruby.wasm and return an instantiated VM.
 *
 * @throws Re-throws the underlying error after setting the verdict to "fail".
 */
export async function loadVivariumRuby(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const rubyWasmVersion = options.rubyWasmVersion ?? DEFAULT_RUBY_WASM_VERSION;
  const rubyVersion = options.rubyVersion ?? DEFAULT_RUBY_VERSION;
  const pendingText = options.pendingText ?? "Loading Ruby.wasm runtime…";

  setVerdict("pending", pendingText);

  const loaderUrl = `https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@${rubyWasmVersion}/dist/browser/+esm`;
  const wasmUrl = `https://cdn.jsdelivr.net/npm/@ruby/${rubyVersion}-wasm-wasi@${rubyWasmVersion}/dist/ruby+stdlib.wasm`;

  try {
    const mod = (await import(/* @vite-ignore */ loaderUrl)) as {
      DefaultRubyVM: (
        module: WebAssembly.Module,
      ) => Promise<{ vm: RubyVMInstance }>;
    };
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `failed to fetch ruby+stdlib.wasm (${response.status} ${response.statusText})`,
      );
    }
    const buffer = await response.arrayBuffer();
    const wasmModule = await WebAssembly.compile(buffer);
    const { vm } = await mod.DefaultRubyVM(wasmModule);
    return { vm, rubyWasmVersion, rubyVersion };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "fail",
      `reproduction failed — runtime error during Ruby.wasm load: ${message}`,
    );
    throw err;
  }
}
