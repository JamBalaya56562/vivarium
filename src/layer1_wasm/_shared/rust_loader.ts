import { setVerdict } from "./verdict.js";
import { pick } from "./i18n.js";

const S = pick(
  { pending: 'Loading Rust wasm via WASI shim…' },
  { pending: 'WASI shim 経由で Rust wasm を読み込み中…' },
);

export const DEFAULT_WASI_SHIM_VERSION = "0.4.2";

export interface LoadOptions {
  wasmUrl: string;
  wasiShimVersion?: string;
  pendingText?: string;
  announceVerdict?: boolean;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RustRunner {
  run(): Promise<RunResult>;
}

export interface LoadResult {
  rust: RustRunner;
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

export async function loadVivariumRust(
  options: LoadOptions,
): Promise<LoadResult> {
  const wasiShimVersion = options.wasiShimVersion ?? DEFAULT_WASI_SHIM_VERSION;
  const pendingText = options.pendingText ?? S.pending;
  const announceVerdict = options.announceVerdict ?? true;

  if (announceVerdict) {
    setVerdict("pending", pendingText, "loading");
    emitProgress(5, "Initialising…", "");
  }

  const shimUrl = `https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@${wasiShimVersion}/dist/index.js`;

  try {
    if (announceVerdict) emitProgress(20, "Fetching WASI shim…", "");
    const shim = (await import(/* @vite-ignore */ shimUrl)) as WasiShimModule;

    if (announceVerdict) emitProgress(45, "Downloading repro.wasm…", "");
    const wasmResponse = await fetch(options.wasmUrl);
    if (!wasmResponse.ok) {
      throw new Error(
        `failed to fetch wasm artefact at ${options.wasmUrl} (${wasmResponse.status} ${wasmResponse.statusText})`,
      );
    }
    const wasmBytes = await wasmResponse.arrayBuffer();
    const sizeMB = (wasmBytes.byteLength / 1_000_000).toFixed(2);

    if (announceVerdict) emitProgress(78, "Compiling WebAssembly…", `${sizeMB} MB`);
    const wasmModule = await WebAssembly.compile(wasmBytes);

    if (announceVerdict) emitProgress(94, "Runtime ready.", `${sizeMB} MB`);

    const rust: RustRunner = {
      async run(): Promise<RunResult> {
        let stdout = "";
        let stderr = "";
        const fds = [
          new shim.OpenFile(new shim.File([])),
          shim.ConsoleStdout.lineBuffered((line: string) => {
            stdout += `${line}\n`;
          }),
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
    if (announceVerdict) {
      setVerdict(
        "unreproduced",
        `bug not reproduced — runtime error during Rust wasm load: ${message}`,
      );
    }
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
