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

/**
 * @typedef {Object} VivariumResultV1Bug
 * @property {string} project       Upstream project short name (e.g. "pandas").
 * @property {number} issue         Upstream issue number, no `#` prefix.
 * @property {string} upstream_url  URL to the upstream issue or PR.
 */

/**
 * @typedef {Object} VivariumResultV1Runtime
 * @property {string} name                       Runtime name (e.g. "pyodide").
 * @property {string} version                    Runtime version (e.g. "0.29.3").
 * @property {Record<string, string>} extras     Free-form extras (python, pandas versions, etc.).
 */

/**
 * @typedef {Object} VivariumResultV1Timing
 * @property {string} started_at   ISO-8601 timestamp.
 * @property {string} finished_at  ISO-8601 timestamp.
 * @property {number} duration_ms  Wall-clock duration in milliseconds.
 */

/**
 * @typedef {Object} VivariumResultV1
 * @property {"v1"} contract
 * @property {VivariumResultV1Bug} bug
 * @property {VivariumResultV1Runtime} runtime
 * @property {Record<string, unknown>} result    Page-specific structured output.
 * @property {VivariumResultV1Timing} timing
 */

/**
 * Update the verdict element + the `__VIVARIUM_VERDICT__` global atomically.
 *
 * @param {"pending" | "pass" | "fail"} state
 * @param {string} text Human-readable verdict. Should start with
 *   "reproduction succeeded", "reproduction failed", or a page-specific
 *   pending message — see ADR-0008.
 */
export function setVerdict(state, text) {
  const el = document.getElementById("verdict");
  if (!el) {
    throw new Error(
      'vivarium contract v1: missing element with id="verdict".',
    );
  }
  el.classList.remove("pass", "fail", "pending");
  el.classList.add(state);
  el.dataset.verdict = state;
  el.textContent = text;
  globalThis.__VIVARIUM_VERDICT__ = state;
}

/**
 * Publish the structured result envelope on `__VIVARIUM_RESULT__`.
 *
 * @param {VivariumResultV1} envelope
 */
export function setResult(envelope) {
  if (!envelope || envelope.contract !== "v1") {
    throw new Error(
      `vivarium contract v1: setResult expected contract="v1", got ${
        envelope ? JSON.stringify(envelope.contract) : "null"
      }.`,
    );
  }
  globalThis.__VIVARIUM_RESULT__ = envelope;
}
