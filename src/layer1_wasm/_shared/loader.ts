export const DEFAULT_PYODIDE_VERSION = "314.0.6";

const SIZE_RUNTIME_MB = 12.0; // wasm + stdlib + lockfile combined
const SIZE_PER_PACKAGE_MB = 0.6; // typical for sqlite3, pandas-light, etc.

export function totalEstimatedMB(packageCount: number): number {
  return SIZE_RUNTIME_MB + packageCount * SIZE_PER_PACKAGE_MB;
}
