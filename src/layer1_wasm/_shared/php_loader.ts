import { setVerdict } from "./verdict.js";
import { pick } from "./i18n.js";

const S = pick(
  { pending: 'Loading php-wasm runtime…' },
  { pending: 'php-wasm runtime を読み込み中…' },
);

// 0.1.0 drops SimpleXML from the default build and reshapes the PhpWeb
// constructor, so php-12167 cannot run on it.
export const DEFAULT_PHP_WASM_VERSION = "0.0.8";

export interface LoadOptions {
  phpWasmVersion?: string;
  pendingText?: string;
}

export interface PhpRunResult {
  exitCode: number;
  stdout: string;
}

export interface PhpRunner {
  run(code: string): Promise<PhpRunResult>;
}

export interface LoadResult {
  php: PhpRunner;
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

export async function loadVivariumPhp(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const phpWasmVersion = options.phpWasmVersion ?? DEFAULT_PHP_WASM_VERSION;
  const pendingText = options.pendingText ?? S.pending;

  const total = 8.0; // php-wasm bundle is ~7-8 MB

  setVerdict("pending", pendingText, "loading");
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
