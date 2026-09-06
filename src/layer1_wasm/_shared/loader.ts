import { pick } from "./i18n.js";

interface LoaderStrings {
  complete: string;
}

const STRINGS: LoaderStrings = {
  complete: "Reproduction complete.",
};

const STRINGS_JA: Partial<LoaderStrings> = {
  complete: "再現完了。",
};

const S = pick(STRINGS, STRINGS_JA);

export const DEFAULT_PYODIDE_VERSION = "314.0.6";

const SIZE_RUNTIME_MB = 12.0; // wasm + stdlib + lockfile combined
const SIZE_PER_PACKAGE_MB = 0.6; // typical for sqlite3, pandas-light, etc.

export function totalEstimatedMB(packageCount: number): number {
  return SIZE_RUNTIME_MB + packageCount * SIZE_PER_PACKAGE_MB;
}

export function markReproductionDone(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent("vh-progress", {
      detail: { pct: 100, label: S.complete, bytes: "", stage: "done" },
    }),
  );
}
