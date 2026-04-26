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

import { setVerdict } from "./verdict.js";

export const DEFAULT_PYODIDE_VERSION = "0.29.3";

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

  setVerdict("pending", pendingText);

  const pyodideUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.mjs`;
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

  try {
    const mod = (await import(/* @vite-ignore */ pyodideUrl)) as {
      loadPyodide: (opts: {
        indexURL: string;
        packages?: string[];
      }) => Promise<PyodideInstance>;
    };
    const pyodide = await mod.loadPyodide({ indexURL, packages });
    return { pyodide, version };
  } catch (err: unknown) {
    const errAny = err as { stack?: string; message?: string } | null;
    const message =
      (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
    setVerdict(
      "fail",
      `reproduction failed — runtime error during Pyodide load: ${message}`,
    );
    throw err;
  }
}
