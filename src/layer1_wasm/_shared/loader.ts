// Vivarium contract v1 — Pyodide loader.
//
// Loads Pyodide from the jsDelivr CDN with a pinned version and an optional
// list of preload packages. On any load failure, the helper sets the verdict
// to "fail" with the error text so the caller does not have to duplicate
// that plumbing — and re-throws so the caller can also short-circuit.
//
// Pages should still also wrap their reproduction code in `try/catch` and
// call `setVerdict("fail", ...)` themselves on REPRODUCTION-time errors —
// this helper only owns load-time errors.
//
// Side-effect: imports `./chrome.js` so every Layer 1 page gets the
// shared nav / footer / theme toggle / progress bar / service-worker
// registration without each HTML having to add a `<script>` tag.

// chrome.js is imported via verdict.ts — see comment there.
import { setVerdict } from "./verdict.js";

export const DEFAULT_PYODIDE_VERSION = "0.29.3";

// Approximate sizes (MB) for the progress-bar UI. These are the
// CDN-reported transfer sizes for v0.29.3 and don't need to be
// pinpoint-accurate — the bar is for "did the load progress?" feedback,
// not telemetry. Update if a future Pyodide bump shifts them noticeably.
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
  /**
   * Pyodide version to load (default "0.29.3"). Keep in sync with the
   * `<link rel="modulepreload">` in the page's `<head>`.
   */
  version?: string;
  /**
   * Packages to preload alongside the runtime (e.g. `["pandas"]`).
   * Loaded in parallel with the Pyodide bootstrap.
   */
  packages?: string[];
  /** Verdict message shown while loading (default "Loading Pyodide runtime…"). */
  pendingText?: string;
}

/**
 * Pyodide instance. Typed as `unknown` for now because there is no
 * lightweight `@types/pyodide` package; reproductions cast or refine
 * locally where they call into the runtime.
 */
export type PyodideInstance = unknown;

export interface LoadResult {
  pyodide: PyodideInstance;
  /** Version string actually used (echoes `options.version` or the default). */
  version: string;
}

/**
 * Load Pyodide and return the runtime instance.
 *
 * @throws Re-throws the underlying error after setting the verdict to "fail".
 */
export async function loadVivariumPyodide(
  options: LoadOptions = {},
): Promise<LoadResult> {
  const version = options.version ?? DEFAULT_PYODIDE_VERSION;
  const packages = options.packages ?? [];
  const pendingText = options.pendingText ?? "Loading Pyodide runtime…";
  const total = totalEstimatedMB(packages.length);

  setVerdict("pending", pendingText);
  emitProgress({
    pct: 5,
    label: "Initialising…",
    bytes: `0.0 MB / ${total.toFixed(1)} MB`,
    stage: "init",
  });

  const pyodideUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.mjs`;
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

  try {
    emitProgress({
      pct: 18,
      label: "Fetching Pyodide module…",
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
      label: "Loading runtime + stdlib…",
      bytes: `0.0 MB / ${total.toFixed(1)} MB`,
      stage: "runtime",
    });

    const pyodide = await mod.loadPyodide({ indexURL, packages });

    emitProgress({
      pct: 92,
      label:
        packages.length > 0
          ? `Loaded ${packages.length} package${packages.length > 1 ? "s" : ""}.`
          : "Runtime ready.",
      bytes: `${total.toFixed(1)} MB / ${total.toFixed(1)} MB`,
      stage: "packages",
    });

    return { pyodide, version };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "fail",
      `reproduction failed — runtime error during Pyodide load: ${message}`,
    );
    emitProgress({
      pct: 100,
      label: "Load failed.",
      bytes: "",
      stage: "done",
    });
    throw err;
  }
}

/**
 * Mark the in-page reproduction as fully complete. Calls this from a
 * reproduction page once it has set its final verdict — the chrome.js
 * progress bar fades out.
 */
export function markReproductionDone(): void {
  emitProgress({
    pct: 100,
    label: "Reproduction complete.",
    bytes: "",
    stage: "done",
  });
}
