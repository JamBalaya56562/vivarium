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

import { setVerdict } from "./verdict.mjs";

const DEFAULT_PYODIDE_VERSION = "0.29.3";

/**
 * @typedef {Object} LoadOptions
 * @property {string} [version]      Pyodide version to load (default "0.29.3").
 *   Keep in sync with the `<link rel="modulepreload">` in the page's `<head>`.
 * @property {string[]} [packages]   Packages to preload alongside the runtime
 *   (e.g. `["pandas"]`). Loaded in parallel with the Pyodide bootstrap.
 * @property {string} [pendingText]  Verdict message shown while loading
 *   (default "Loading Pyodide runtime…").
 */

/**
 * Load Pyodide and return the runtime instance.
 *
 * @param {LoadOptions} [options]
 * @returns {Promise<{ pyodide: any, version: string }>}
 *   The Pyodide instance and the version string actually used.
 * @throws Re-throws the underlying error after setting the verdict to "fail".
 */
export async function loadVivariumPyodide(options = {}) {
  const version = options.version ?? DEFAULT_PYODIDE_VERSION;
  const packages = options.packages ?? [];
  const pendingText = options.pendingText ?? "Loading Pyodide runtime…";

  setVerdict("pending", pendingText);

  const pyodideUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide.mjs`;
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

  try {
    const { loadPyodide } = await import(pyodideUrl);
    const pyodide = await loadPyodide({ indexURL, packages });
    return { pyodide, version };
  } catch (err) {
    const message =
      (err && (err.stack || err.message)) || String(err);
    setVerdict(
      "fail",
      `reproduction failed — runtime error during Pyodide load: ${message}`,
    );
    throw err;
  }
}

export { DEFAULT_PYODIDE_VERSION };
