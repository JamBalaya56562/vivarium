// Shared helpers for Layer 1 recipes that render a baseline + fix-candidate
// side-by-side comparison on a single Pyodide instance.
//
// Two pieces are duplicated across every "main-thread Pyodide" recipe
// that adopts the dual-variant pattern (dateutil-1478 and future
// analogues):
//
//   1. `reinstallPyodidePackage` — `micropip.uninstall` followed by
//      a `sys.modules` purge (to defeat Pyodide's import cache) and
//      then `micropip.install` of either the baseline pin or the
//      `./wheels/<filename>` fix-candidate wheel. The Python template
//      is invariant across recipes; only the pip package name, the
//      Python module root, and the install spec differ.
//
//   2. `fetchWheelManifest` — the small dance that fetches
//      `./wheels/manifest.json` next to the recipe page, validates the
//      shape, and resolves the wheel URL the runtime is going to pass
//      to `micropip.install`. CI builds the wheel via
//      `scripts/build-layer1-wheels.sh` from each recipe's tracked
//      `fix-candidate.json`; the manifest is the contract between
//      that build step and the in-page loader.
//
// Worker-based dual-variant recipes (lark-1585) bypass this helper —
// they spawn an independent Pyodide instance per variant and do not
// need the uninstall/reinstall dance, so the worker pattern lives in
// the recipe itself rather than here.
//
// The validator under `scripts/validate-output-panes.ts` enforces
// that any recipe with `fix-candidate.json` also ships the matching
// HTML + JS wiring (vh-output-multi pane, `#output-fix` element,
// `./wheels/manifest.json` reference). That guard is independent of
// whether the recipe uses this helper — both worker-pattern and
// main-thread-pattern recipes pass the same validator.

/**
 * The minimal slice of the Pyodide runtime this helper depends on.
 * Recipes typically declare a richer interface locally (with a
 * `toJs()`-capable proxy return type for `runPythonAsync`); this is
 * just the surface this module needs.
 */
export interface PyodideRuntime {
  runPythonAsync(code: string): Promise<unknown>;
}

/**
 * Shape of `wheels/manifest.json` produced by
 * `scripts/build-layer1-wheels.sh`. Mirrors the structure that
 * shell script writes via `jq -n` — keep the two in sync.
 */
export interface WheelManifest {
  schema_version: number;
  package: string;
  filename: string;
  version: string;
  purpose?: string;
  source: {
    type: string;
    url: string;
    ref: string;
    commit?: string;
    spec?: string;
    subdirectory?: string;
  };
  upstream_pr?: string;
  fetched_at?: string;
}

/**
 * Reinstall a Python package inside a running Pyodide instance,
 * defeating the in-process import cache so the next `import` resolves
 * the freshly-installed version.
 *
 * - `pipPackageName` is what `micropip` knows the project as
 *   (e.g. `"python-dateutil"`, `"lark"`).
 * - `pythonRootModule` is the top-level package name as Python sees
 *   it after import (e.g. `"dateutil"`, `"lark"`). Often equal to
 *   `pipPackageName`, but not always — `python-dateutil` exposes
 *   `dateutil`.
 * - `installSpec` is the argument handed to `micropip.install(...)`
 *   — a PyPI pin like `"lark==1.3.0"` or an absolute wheel URL like
 *   `"http://localhost:.../wheels/<file>.whl"`.
 *
 * The function is best-effort on uninstall: a project that was never
 * installed in this session raises a `ValueError` inside micropip,
 * which we swallow so the helper is also callable as a plain "install"
 * on the first variant.
 */
export async function reinstallPyodidePackage(
  runtime: PyodideRuntime,
  args: {
    pipPackageName: string;
    pythonRootModule: string;
    installSpec: string;
  },
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall(${JSON.stringify(args.pipPackageName)})
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == ${JSON.stringify(args.pythonRootModule)} or n.startswith(${JSON.stringify(`${args.pythonRootModule}.`)})]:
    del sys.modules[_name]
await micropip.install(${JSON.stringify(args.installSpec)})
`);
}

export type FetchWheelManifestOutcome =
  | { ok: true; manifest: WheelManifest; wheelUrl: string }
  | { ok: false; reason: string };

/**
 * Fetch `./wheels/manifest.json` next to the recipe page, parse it,
 * and resolve the absolute URL of the wheel file the recipe should
 * hand to `micropip.install`.
 *
 * The wheel itself lives at `./wheels/<manifest.filename>` (sibling
 * of the manifest). Returning the resolved URL here keeps the URL
 * construction logic in one place so future tweaks (e.g. a CDN
 * prefix) only need to land here.
 *
 * Returns a tagged result instead of throwing: any failure (HTTP
 * error, network drop, JSON parse error) yields `{ ok: false }` with
 * a human-readable reason the recipe can surface in the
 * fix-candidate pane. The recipe stays responsible for verdict
 * polarity — the helper never flips it.
 */
export async function fetchWheelManifest(opts?: {
  /** Override the default `./wheels/manifest.json` location. Useful in tests. */
  manifestUrl?: string;
}): Promise<FetchWheelManifestOutcome> {
  const manifestUrl = opts?.manifestUrl ?? './wheels/manifest.json';
  let res: Response;
  try {
    res = await fetch(manifestUrl, { cache: 'no-store' });
  } catch (err) {
    return {
      ok: false,
      reason: `could not fetch wheel manifest: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `wheel manifest unavailable (HTTP ${res.status}).`,
    };
  }
  let manifest: WheelManifest;
  try {
    manifest = (await res.json()) as WheelManifest;
  } catch (err) {
    return {
      ok: false,
      reason: `wheel manifest is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!manifest.filename) {
    return {
      ok: false,
      reason: 'wheel manifest is missing `filename` field.',
    };
  }
  const wheelUrl = new URL(
    `./wheels/${manifest.filename}`,
    window.location.href,
  ).toString();
  return { ok: true, manifest, wheelUrl };
}

/**
 * Resolve the spec string that should appear in
 * `result.fix_candidate.spec` of the Contract v1 envelope.
 *
 * Prefers `manifest.source.spec` (the exact `pip` spec the wheel
 * build resolved); falls back to reconstructing
 * `<package> @ git+<url>@<ref>[#subdirectory=<dir>]` so the spec is
 * never `undefined`. The fallback matches the shape
 * `scripts/build-layer1-wheels.sh` writes, so the two paths are
 * indistinguishable to envelope consumers.
 */
export function resolveFixCandidateSpec(
  manifest: WheelManifest,
  pipPackageName: string,
): string {
  if (manifest.source.spec) return manifest.source.spec;
  const base = `${pipPackageName} @ git+${manifest.source.url}@${manifest.source.ref}`;
  return manifest.source.subdirectory
    ? `${base}#subdirectory=${manifest.source.subdirectory}`
    : base;
}
