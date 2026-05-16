# Reproduction — HypothesisWorks/hypothesis#4651

> Layer 1 reproduction page — installs a third-party Python package
> via `micropip`. Conforms to `vivarium-contract: v1`. The recipe was
> drafted by an AI agent (Claude Code, Opus 4.7); see the
> [Authorship](#authorship) note below.

## The bug

[HypothesisWorks/hypothesis#4651](https://github.com/HypothesisWorks/hypothesis/issues/4651)
— `st.decimals(min_value, max_value, places=N)` returns
`Decimal` values that exceed the declared `[min_value, max_value]`
range when both bounds have many significant digits.

```python
import decimal
from hypothesis import given, settings
from hypothesis.strategies import decimals

min_ = decimal.Decimal(f"0.{'0' * 63}1")
max_ = decimal.Decimal(f"{'9' * 64}.{'9' * 64}")

@given(decimals(min_value=min_, max_value=max_, places=2))
@settings(max_examples=10000)
def f(d):
    assert min_ <= d <= max_

f()
# Falsifying example: f(d=int_to_decimal(10**78))   ← far above max_
```

The suspected fix area is the internal `ctx(val)` helper in
[`hypothesis/strategies/_internal/core.py:1811`](https://github.com/HypothesisWorks/hypothesis/blob/master/hypothesis-python/src/hypothesis/strategies/_internal/core.py#L1811):

```python
def ctx(val):
    """Return a context in which this value is lossless."""
    precision = ceil(math.log10(abs(val) or 1)) + places + 1
    return Context(prec=max([precision, 1]))
```

For `min_value = Decimal("0." + "0" * 63 + "1")`, `math.log10(abs(val))`
is roughly `-64`, so `ceil(...) + places + 1` is negative — and the
`max([precision, 1])` floor clamps the working precision to 1.
`ctx(min_value).divide(min_value, factor)` then loses essentially
every coefficient digit, and the strategy ends up sampling integers
whose `* 10^-places` re-projection lands far outside the declared
range. The closed PRs ([#4668](https://github.com/HypothesisWorks/hypothesis/pull/4668),
[#4688](https://github.com/HypothesisWorks/hypothesis/pull/4688))
both propose deriving precision from the `Decimal` coefficient's
digit count rather than `math.log10(magnitude)`, but were rejected
without merge for unrelated authorship reasons. The bug itself
remains open as of 2026-05-16.

## Why this bug

- Pure Python — hypothesis pulls in `attrs` and `sortedcontainers`,
  also pure Python. No native extensions, no I/O, no thread
  scheduler. Pyodide installs all three wheels from PyPI via
  `micropip` in seconds.
- Reproduction is two independent signal paths (a bounded
  `@given` search and a manual `strategy.example()` sweep). The
  verdict reduces to a boolean: at least one sample violated the
  declared bounds → bug. Either path alone suffices, so a recipe
  emits a mechanically-distinguishable
  `reproduced` / `unreproduced` even if the WASM runtime breaks
  one of the two signals.
- Reported against hypothesis 6.116.0; the latest release at
  authoring time is 6.152.7 (2026-05-16) and the bug still
  reproduces there. Pinning in PEP 723 / `repro.ts` to that exact
  version locks the verdict to a known-bad build, so the page
  flips to `unreproduced` only when a new hypothesis release lands
  an actual fix.
- Demonstrates Vivarium handles **property-based-testing
  strategy-invariant** bugs — strategies that violate the bounds
  they themselves declare. This category is distinct from
  `mpmath-983` (numerical stability) and `astroid-2993`
  (parser memory error), so it broadens the Layer 1 catalogue.

## Files

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Static page; declares `<meta name="vivarium-contract" content="v1">`. Renders baseline + fix-candidate output panes side-by-side. |
| `repro.ts`   | TypeScript source. Imports `loadVivariumPyodide` and the verdict helpers from `../_shared/`. Compiled to `repro.js` by `bun run build` from `src/layer1_wasm/`. Drives the two-variant run. |
| `repro.js`   | Generated; gitignored. Loaded by `index.html` at runtime.         |
| `repro.py`   | **Native CLI variant.** Same reproduction logic, runnable directly under a real CPython interpreter via `uv run`. PEP 723 inline metadata pins `hypothesis==6.152.7`. |
| `fix-candidate.json` | **Tracked.** Single source of truth for the fix branch the page renders alongside the baseline (fork repo URL, branch ref, and `subdirectory: hypothesis-python` because the installable package lives there in this monorepo). Read by `scripts/build-layer1-wheels.sh`. |
| `verify_fix.py` | **Maintainer convenience.** PEP 723 native orchestrator that runs the reproduction against **both** the baseline pin and the fix-candidate spec in side-by-side `uv run --no-project --with <spec>` venvs, so a reviewer can see the before/after verdict in one command. Exits 0 iff baseline reproduces AND fix-candidate does not. Deleted once the fix is merged upstream and released on PyPI. |
| `wheels/`    | Generated; gitignored. `mise run repro:build:wheels` (`scripts/build-layer1-wheels.sh`) builds `hypothesis-<version>-py3-none-any.whl` from `fix-candidate.json` plus a `manifest.json` (filename + version + resolved commit + spec). `repro.ts` fetches the manifest at page load to install the fix candidate in the same Pyodide tab. |

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result`
field of the envelope reports `min_value`, `max_value`, `places`,
the `hypothesis_falsifying` example string (or `null`),
`manual_violation_count`, and the boolean `bound_violated`.

A `reproduced` verdict means **the bug reproduced** — either the
bounded `@given` search caught an `AssertionError` from a
bound-violating sample, or the manual sweep observed at least one
`strategy.example()` value outside `[min_value, max_value]`. An
`unreproduced` verdict means both paths returned empty (the
strategy respected its declared bounds across every sample, or the
runtime errored before producing a result).

## Running locally — in-browser

```bash
cd src/layer1_wasm
bun install
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/hypothesis-4651/
```

The page first preloads `micropip`, then installs
`hypothesis==6.152.7` (plus its `attrs` + `sortedcontainers`
transitive dependencies) from PyPI on the visitor's machine before
running the reproduction. First-visit cold load is slower than
recipes that exercise only Pyodide-bundled packages.

## Native verification — same reproduction under a real CPython

```bash
mise install
mise exec uv -- uv run src/layer1_wasm/hypothesis-4651/repro.py
# verdict=reproduced — st.decimals(places=…) produced a Decimal outside the declared bounds
```

## Fix-candidate verification

A fork+branch carrying a proposed fix is rendered **side-by-side**
with the baseline on the same page, so a reviewer can see the
before/after verdict in one page load.

- **Fix branch:**
  <https://github.com/JamBalaya56562/hypothesis/tree/fix-decimals-places-bounds>
  (monorepo — the installable Python package lives under
  `hypothesis-python/`, declared via `source.subdirectory` in
  `fix-candidate.json`).
- **What the page shows:**
  - top right pane (`#output`) — baseline run against PyPI
    `hypothesis==6.152.7`. Expected `bound_violated: true`.
  - bottom right pane (`#output-fix`) — fix-candidate run against
    the wheel built from the branch. Expected `bound_violated: false`.
  - top-level `#verdict` pill mirrors the baseline so the existing
    single-verdict Contract v1 surface keeps its prior meaning.

### Local in-browser

```bash
mise run repro:build:wheels                      # build wheel into src/layer1_wasm/hypothesis-4651/wheels/
cd src/layer1_wasm
bun install --frozen-lockfile
bun run build
python -m http.server -d . 8767
# open http://localhost:8767/hypothesis-4651/
```

### Local native (two-variant)

```bash
mise exec uv -- uv run src/layer1_wasm/hypothesis-4651/verify_fix.py
# stdout: JSON envelope with both verdicts side-by-side
# exit 0 + "verdict=fix-candidate-confirmed" if baseline=reproduced AND fix-candidate=unreproduced
```

### When the fix lands upstream

Once an upstream-merged hypothesis release lands on PyPI:

1. Bump the `hypothesis==<version>` pin in `repro.py` and `repro.ts`.
2. Delete `fix-candidate.json`, `verify_fix.py`, and the `wheels/`
   directory.
3. Restore `index.html` to a single-output pane (`<pre id="output">`)
   and drop the `outputFixEl` branch from `repro.ts`.

The page becomes a plain "fixed upstream — verdict flips to
`unreproduced`" recipe again.

## Authorship

This recipe was authored by an AI agent (Claude Code, Opus 4.7)
acting on instructions from the human maintainer. The vivarium
project itself is AI-delegated by design; the
[`ai: generated`](https://github.com/aletheia-works/vivarium/labels/ai%3A%20generated)
label is applied to every PR an AI agent opens, so reviewers can
calibrate accordingly. No upstream PR is being opened against
`HypothesisWorks/hypothesis` from this recipe — the verdict page
is a stand-alone reproduction artefact.

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/hypothesis/4651/` by
the `deploy-docs` workflow.
