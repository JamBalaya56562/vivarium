// Vivarium contract v1 — php-wasm loader.
//
// Loads `php-wasm` from jsDelivr, instantiates `PhpWeb`, and returns a
// thin `runPhp` wrapper that captures stdout via the runtime's
// `output` event and resolves to `{ exitCode, stdout }`. On any
// load-time failure the helper sets the verdict to "unreproduced" with the
// error text and re-throws — mirroring `loader.ts` (Pyodide) and
// `ruby_loader.ts` (Ruby.wasm).
//
// Pages should still wrap their reproduction code in `try/catch` and
// call `setVerdict("unreproduced", ...)` themselves on REPRODUCTION-time errors;
// this helper only owns load-time errors.
//
// php-wasm@0.0.8 ships PHP 8.2.11 (Linux, 32-bit, Zend 4.2.11) with
// 27 bundled extensions including SimpleXML, sqlite3, mbstring, json,
// PDO, and pdo_sqlite — confirmed in-browser; do not rely on this
// version mapping without re-checking via `PHP_VERSION` in the
// reproduction script.

import { setVerdict } from "./verdict.js";

/** `php-wasm` npm package version. Bumping requires updating the
 *  `<link rel="modulepreload">` in pages that preload this URL. */
export const DEFAULT_PHP_WASM_VERSION = "0.0.8";

export interface LoadOptions {
  /** Override the `php-wasm` package version. */
  phpWasmVersion?: string;
  /** Verdict message shown while loading (default "Loading php-wasm runtime…"). */
  pendingText?: string;
}

export interface PhpRunResult {
  /** Exit code returned by `PhpWeb.run`. 0 indicates a clean run. */
  exitCode: number;
  /** Concatenated stdout across all `output` events emitted during the
   *  run. Includes trailing newlines if the script wrote them. */
  stdout: string;
}

export interface PhpRunner {
  /** Execute a PHP source string (must include the `<?php` open tag)
   *  and resolve to the exit code + captured stdout. */
  run(code: string): Promise<PhpRunResult>;
}

export interface LoadResult {
  php: PhpRunner;
  /** Echoes `options.phpWasmVersion` or the default. */
  phpWasmVersion: string;
}

interface PhpWebInstance {
  addEventListener(
    type: "ready" | "error" | "output",
    listener: (event: Event & { detail?: string | undefined }) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(
    type: "ready" | "error" | "output",
    listener: (event: Event & { detail?: string | undefined }) => void,
  ): void;
  run(code: string): Promise<number>;
}

/**
 * Load php-wasm and return a thin runner.
 *
 * @throws Re-throws the underlying error after setting the verdict to "unreproduced".
 */
export async function loadVivariumPhp(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const phpWasmVersion = options.phpWasmVersion ?? DEFAULT_PHP_WASM_VERSION;
  const pendingText = options.pendingText ?? "Loading php-wasm runtime…";

  const total = 8.0; // php-wasm bundle is ~7-8 MB

  setVerdict("pending", pendingText);
  emitProgress(5, "Initialising…", `0.0 MB / ${total.toFixed(1)} MB`);

  const loaderUrl = `https://cdn.jsdelivr.net/npm/php-wasm@${phpWasmVersion}/PhpWeb.mjs`;

  try {
    emitProgress(20, "Fetching php-wasm loader…", `0.0 MB / ${total.toFixed(1)} MB`);
    const mod = (await import(/* @vite-ignore */ loaderUrl)) as {
      PhpWeb: new () => PhpWebInstance;
    };

    emitProgress(45, "Loading PHP runtime + extensions…", `0.0 MB / ${total.toFixed(1)} MB`);
    const instance = new mod.PhpWeb();
    await new Promise<void>((resolve, reject) => {
      instance.addEventListener("ready", () => resolve(), { once: true });
      instance.addEventListener(
        "error",
        (event) => reject(new Error(event.detail ?? "php-wasm error")),
        { once: true },
      );
    });

    emitProgress(94, "Runtime ready.", `${total.toFixed(1)} MB / ${total.toFixed(1)} MB`);

    const php: PhpRunner = {
      async run(code: string): Promise<PhpRunResult> {
        let stdout = "";
        const onOutput = (event: Event & { detail?: string | undefined }) => {
          stdout += event.detail ?? "";
        };
        instance.addEventListener("output", onOutput);
        try {
          const exitCode = await instance.run(code);
          return { exitCode, stdout };
        } finally {
          instance.removeEventListener("output", onOutput);
        }
      },
    };
    return { php, phpWasmVersion };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error during php-wasm load: ${message}`,
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
