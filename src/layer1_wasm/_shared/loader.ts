import { setVerdict } from "./verdict.js";
import { pick } from "./i18n.js";

interface LoaderStrings {
  pending: string;
  initialising: string;
  fetchingModule: string;
  loadingRuntime: string;
  loadedPackages: (n: number) => string;
  runtimeReady: string;
  loadFailed: string;
  loadError: (message: string) => string;
  complete: string;
}

const STRINGS: LoaderStrings = {
  pending: "Loading Pyodide runtime\u2026",
  initialising: "Initialising\u2026",
  fetchingModule: "Fetching Pyodide module\u2026",
  loadingRuntime: "Loading runtime + stdlib\u2026",
  loadedPackages: (n) => `Loaded ${n} package${n > 1 ? "s" : ""}.`,
  runtimeReady: "Runtime ready.",
  loadFailed: "Load failed.",
  loadError: (m) => `bug not reproduced \u2014 runtime error during Pyodide load: ${m}`,
  complete: "Reproduction complete.",
};

const STRINGS_JA: Partial<LoaderStrings> = {
  pending: "Pyodide runtime \u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u2026",
  initialising: "\u521d\u671f\u5316\u4e2d\u2026",
  fetchingModule: "Pyodide \u30e2\u30b8\u30e5\u30fc\u30eb\u3092\u53d6\u5f97\u4e2d\u2026",
  loadingRuntime: "runtime \u3068 stdlib \u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u2026",
  loadedPackages: (n) => `${n} \u500b\u306e\u30d1\u30c3\u30b1\u30fc\u30b8\u3092\u8aad\u307f\u8fbc\u3093\u3060\u3002`,
  runtimeReady: "runtime \u306e\u6e96\u5099\u5b8c\u4e86\u3002",
  loadFailed: "\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u305f\u3002",
  loadError: (m) => `bug \u306f\u518d\u73fe\u3057\u306a\u304b\u3063\u305f \u2014 Pyodide \u306e\u8aad\u307f\u8fbc\u307f\u4e2d\u306b runtime \u30a8\u30e9\u30fc: ${m}`,
  complete: "\u518d\u73fe\u5b8c\u4e86\u3002",
};

const S = pick(STRINGS, STRINGS_JA);

export const DEFAULT_PYODIDE_VERSION = "314.0.6";

const SIZE_RUNTIME_MB = 12.0; // wasm + stdlib + lockfile combined
const SIZE_PER_PACKAGE_MB = 0.6; // typical for sqlite3, pandas-light, etc.

function totalEstimatedMB(packageCount: number): number {
  return SIZE_RUNTIME_MB + packageCount * SIZE_PER_PACKAGE_MB;
}

function emitProgress(opts: {
  pct: number;
  label?: string;
  bytes?: string;
  stage?: "init" | "runtime" | "packages" | "running" | "done";
}): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent("vh-progress", {
      detail: {
        pct: opts.pct,
        label: opts.label ?? "",
        bytes: opts.bytes ?? "",
        stage: opts.stage ?? "init",
      },
    }),
  );
}

export interface LoadOptions {
  version?: string;
  packages?: string[];
  pendingText?: string;
}

export type PyodideInstance = unknown;

export interface LoadResult {
  pyodide: PyodideInstance;
  version: string;
}

export async function loadVivariumPyodide(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const version = options.version ?? DEFAULT_PYODIDE_VERSION;
  const packages = options.packages ?? [];
  const pendingText = options.pendingText ?? S.pending;
  const total = totalEstimatedMB(packages.length);

  setVerdict("pending", pendingText, "loading");
  emitProgress({
    pct: 5,
    label: S.initialising,
    bytes: `0.0 MB / ${total.toFixed(1)} MB`,
    stage: "init",
  });

  const pyodideUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.mjs`;
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

  try {
    emitProgress({
      pct: 18,
      label: S.fetchingModule,
      bytes: `0.0 MB / ${total.toFixed(1)} MB`,
      stage: "runtime",
    });

    const mod = (await import(/* @vite-ignore */ pyodideUrl)) as {
      loadPyodide: (opts: {
        indexURL: string;
        packages?: string[];
      }) => Promise<PyodideInstance>;
    };

    emitProgress({
      pct: 35,
      label: S.loadingRuntime,
      bytes: `0.0 MB / ${total.toFixed(1)} MB`,
      stage: "runtime",
    });

    const pyodide = await mod.loadPyodide({ indexURL, packages });

    emitProgress({
      pct: 92,
      label:
        packages.length > 0
          ? S.loadedPackages(packages.length)
          : S.runtimeReady,
      bytes: `${total.toFixed(1)} MB / ${total.toFixed(1)} MB`,
      stage: "packages",
    });

    return { pyodide, version };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "unreproduced",
      S.loadError(message),
    );
    emitProgress({
      pct: 100,
      label: S.loadFailed,
      bytes: "",
      stage: "done",
    });
    throw err;
  }
}

export function markReproductionDone(): void {
  emitProgress({
    pct: 100,
    label: S.complete,
    bytes: "",
    stage: "done",
  });
}
