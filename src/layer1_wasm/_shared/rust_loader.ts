// Vivarium contract v1 — Rust (wasm32-wasip1) loader.
//
// Unlike Pyodide / Ruby.wasm / php-wasm, Rust does not ship a single
// CDN-hosted runtime + stdlib bundle. Each reproduction is its own
// crate compiled to its own `wasm32-wasip1` artefact — `repro.wasm`
// next to the page's `index.html`, produced by the deploy-docs CI
// step (`cargo build --release --target wasm32-wasip1`).
//
// This loader brings up `@bjorn3/browser_wasi_shim` for the WASI
// `proc_exit`, `fd_write`, `clock_time_get`, etc. imports the Rust
// `_start` entry point depends on, then runs the artefact and returns
// the captured stdout/stderr + exit code. On any load-time failure it
// sets the verdict to "fail" with the error text and re-throws —
// mirroring `loader.ts` (Pyodide), `ruby_loader.ts` (Ruby.wasm), and
// `php_loader.ts` (php-wasm).

import { setVerdict } from "./verdict.js";

/** `@bjorn3/browser_wasi_shim` package version. Bumping requires
 *  updating the `<link rel="modulepreload">` in pages that preload
 *  this URL. */
export const DEFAULT_WASI_SHIM_VERSION = "0.4.2";

export interface LoadOptions {
  /** URL of the wasm32-wasip1 artefact, relative to the page or
   *  absolute. Required — the loader can't guess which crate to load. */
  wasmUrl: string;
  /** Override the WASI shim package version. */
  wasiShimVersion?: string;
  /** Verdict message shown while loading (default "Loading Rust wasm via WASI shim…"). */
  pendingText?: string;
}

export interface RunResult {
  /** Exit code from the wasm `_start` entry point. WASI maps a Rust
   *  `std::process::exit(n)` to `proc_exit(n)`, which the shim
   *  surfaces here. */
  exitCode: number;
  /** Concatenated stdout text written by the program. Lines are joined
   *  with "\n" and the trailing newline is preserved if present. */
  stdout: string;
  /** Concatenated stderr text — same semantics as stdout. */
  stderr: string;
}

export interface RustRunner {
  /** Instantiate a fresh WASI environment, run the wasm `_start`
   *  entry point, and resolve to the run's exit code + captured I/O.
   *  Each call creates a new environment, so the same module can be
   *  re-run without cross-talk. */
  run(): Promise<RunResult>;
}

export interface LoadResult {
  rust: RustRunner;
  /** Echoes `options.wasiShimVersion` or the default. */
  wasiShimVersion: string;
}

interface WasiShimModule {
  WASI: new (
    args: string[],
    env: string[],
    fds: unknown[],
  ) => {
    wasiImport: WebAssembly.ModuleImports;
    start(instance: WebAssembly.Instance): number | undefined;
  };
  OpenFile: new (file: unknown) => unknown;
  File: new (data: Uint8Array | number[]) => unknown;
  ConsoleStdout: {
    lineBuffered(onLine: (line: string) => void): unknown;
  };
}

/**
 * Compile a wasm32-wasip1 artefact and return a runner that can
 * execute it under a fresh WASI environment.
 *
 * @throws Re-throws the underlying error after setting the verdict to "fail".
 */
export async function loadVivariumRust(
  options: LoadOptions,
): Promise<LoadResult> {
  const wasiShimVersion = options.wasiShimVersion ?? DEFAULT_WASI_SHIM_VERSION;
  const pendingText = options.pendingText ?? "Loading Rust wasm via WASI shim…";

  setVerdict("pending", pendingText);
  emitProgress(5, "Initialising…", "");

  const shimUrl = `https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@${wasiShimVersion}/dist/index.js`;

  try {
    emitProgress(20, "Fetching WASI shim…", "");
    const shim = (await import(/* @vite-ignore */ shimUrl)) as WasiShimModule;

    emitProgress(45, "Downloading repro.wasm…", "");
    const wasmResponse = await fetch(options.wasmUrl);
    if (!wasmResponse.ok) {
      throw new Error(
        `failed to fetch wasm artefact at ${options.wasmUrl} (${wasmResponse.status} ${wasmResponse.statusText})`,
      );
    }
    const wasmBytes = await wasmResponse.arrayBuffer();
    const sizeMB = (wasmBytes.byteLength / 1_000_000).toFixed(2);

    emitProgress(78, "Compiling WebAssembly…", `${sizeMB} MB`);
    const wasmModule = await WebAssembly.compile(wasmBytes);

    emitProgress(94, "Runtime ready.", `${sizeMB} MB`);

    const rust: RustRunner = {
      async run(): Promise<RunResult> {
        let stdout = "";
        let stderr = "";
        const fds = [
          // stdin: empty file
          new shim.OpenFile(new shim.File([])),
          // stdout: line-buffered into our string
          shim.ConsoleStdout.lineBuffered((line: string) => {
            stdout += `${line}\n`;
          }),
          // stderr: line-buffered into our string
          shim.ConsoleStdout.lineBuffered((line: string) => {
            stderr += `${line}\n`;
          }),
        ];
        const wasi = new shim.WASI([], [], fds);
        const instance = await WebAssembly.instantiate(wasmModule, {
          wasi_snapshot_preview1: wasi.wasiImport,
        });

        let exitCode = 0;
        try {
          const ret = wasi.start(instance);
          if (typeof ret === "number") {
            exitCode = ret;
          }
        } catch (e: unknown) {
          // The shim signals `proc_exit(n)` for non-zero `n` by
          // throwing an object with `exitCode`. Distinguish that
          // from genuine wasm trap / panic, which we want to surface.
          const eAny = e as { exitCode?: number; message?: string };
          if (typeof eAny?.exitCode === "number") {
            exitCode = eAny.exitCode;
          } else {
            throw e;
          }
        }
        return { exitCode, stdout, stderr };
      },
    };
    return { rust, wasiShimVersion };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "fail",
      `reproduction failed — runtime error during Rust wasm load: ${message}`,
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
