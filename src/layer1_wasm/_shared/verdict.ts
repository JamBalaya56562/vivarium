// Vivarium contract v1 — verdict and result envelope helpers.
//
// Pages must include `<meta name="vivarium-contract" content="v1">` in
// `<head>` and an element with `id="verdict"` somewhere in the body.
//
// Surface published by these helpers (per ADR-0008):
// - DOM: `#verdict[data-verdict]` ∈ {"pending", "pass", "fail"}
// - Globals: `__VIVARIUM_VERDICT__`, `__VIVARIUM_RESULT__`
// - Visible text on `#verdict`, set by `setVerdict(state, text)`
//
// `pass` means the bug REPRODUCES (the upstream behaviour is observable in
// the runtime this page loads). `fail` means it does NOT — either the
// runtime ships a fixed version, or the runtime errored before producing a
// result. `pending` means the run has not yet produced a verdict.

export type VerdictState = "pending" | "pass" | "fail";

export interface VivariumResultV1Bug {
  /** Upstream project short name (e.g. "pandas"). */
  project: string;
  /** Upstream issue number, no `#` prefix. */
  issue: number;
  /** URL to the upstream issue or PR. */
  upstream_url: string;
}

export interface VivariumResultV1Runtime {
  /** Runtime name (e.g. "pyodide"). */
  name: string;
  /** Runtime version (e.g. "0.29.3"). */
  version: string;
  /** Free-form extras (python, pandas versions, etc.). */
  extras: Record<string, string>;
}

export interface VivariumResultV1Timing {
  /** ISO-8601 timestamp. */
  started_at: string;
  /** ISO-8601 timestamp. */
  finished_at: string;
  /** Wall-clock duration in milliseconds. */
  duration_ms: number;
}

export interface VivariumResultV1 {
  contract: "v1";
  bug: VivariumResultV1Bug;
  runtime: VivariumResultV1Runtime;
  /** Page-specific structured output. */
  result: Record<string, unknown>;
  timing: VivariumResultV1Timing;
}

declare global {
  // eslint-disable-next-line no-var
  var __VIVARIUM_VERDICT__: VerdictState | undefined;
  // eslint-disable-next-line no-var
  var __VIVARIUM_RESULT__: VivariumResultV1 | undefined;
}

/**
 * Update the verdict element + the `__VIVARIUM_VERDICT__` global atomically.
 *
 * @param state Verdict state.
 * @param text  Human-readable verdict. Should start with
 *   "reproduction succeeded", "reproduction failed", or a page-specific
 *   pending message — see ADR-0008.
 */
export function setVerdict(state: VerdictState, text: string): void {
  const el = document.getElementById("verdict");
  if (!el) {
    throw new Error(
      'vivarium contract v1: missing element with id="verdict".',
    );
  }
  el.classList.remove("pass", "fail", "pending");
  el.classList.add(state);
  el.dataset["verdict"] = state;
  el.textContent = text;
  globalThis.__VIVARIUM_VERDICT__ = state;
}

/**
 * Publish the structured result envelope on `__VIVARIUM_RESULT__`.
 */
export function setResult(envelope: VivariumResultV1): void {
  if (!envelope || envelope.contract !== "v1") {
    throw new Error(
      `vivarium contract v1: setResult expected contract="v1", got ${
        envelope ? JSON.stringify(envelope.contract) : "null"
      }.`,
    );
  }
  globalThis.__VIVARIUM_RESULT__ = envelope;
}
