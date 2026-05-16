// Vivarium Layer 1 reproduction — HypothesisWorks/hypothesis#4651.
//
// `st.decimals(min_value, max_value, places=N)` returns `Decimal`
// values that exceed `max_value` (or fall below `min_value`) when the
// bounds have many significant digits. The strategy quantises the
// sampled value after deciding on a magnitude, but the internal
// arithmetic context's precision is derived from `math.log10(abs(val))`
// (`hypothesis/strategies/_internal/core.py:1811`), which collapses to
// 1 for tiny bounds like `Decimal("0." + "0" * 63 + "1")`. Once
// precision saturates, `ctx(min_value).divide(min_value, factor)`
// loses almost all the coefficient's significant digits, so the
// final quantised Decimal can land far outside the declared range.
//
// Verdict semantics (per ADR-0008 / contract v1) — applied to each
// variant card individually; the top-level `#verdict` pill mirrors
// the **baseline** variant so the existing Contract v1 single-verdict
// surface (`__VIVARIUM_VERDICT__`, `data-verdict`) keeps its prior
// meaning and downstream consumers do not need to branch.
//   - "reproduced" — a Hypothesis search or a manual
//     `strategy.example()` sweep produced at least one `Decimal`
//     outside `[MIN, MAX]`.
//   - "unreproduced" — both signal paths returned empty (the strategy
//     respected its declared bounds on every sample), or the runtime
//     errored before producing a result.
//
// hypothesis is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. hypothesis is pure
// Python and pulls in `attrs` + `sortedcontainers` as transitive
// dependencies — all single pure-Python wheels from PyPI. The
// fix-candidate this page renders side-by-side is a pure-Python wheel
// under `./wheels/` built from the fork+branch
// `JamBalaya56562/hypothesis@fix-decimals-places-bounds`.

import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const REPRO_CODE = `
import sys
import hypothesis
from decimal import Decimal
from hypothesis import given, settings, strategies as st, HealthCheck

MIN_ = Decimal("0." + "0" * 63 + "1")
MAX_ = Decimal("9" * 64 + "." + "9" * 64)
PLACES = 2

result = {
    "hypothesis_version": hypothesis.__version__,
    "python_version": sys.version.split()[0],
    "min_value": str(MIN_),
    "max_value": str(MAX_),
    "places": PLACES,
    "hypothesis_falsifying": None,
    "hypothesis_crash": None,
    "manual_violations": [],
    "manual_crash": None,
    "bound_violated": False,
}

# Approach A — bounded Hypothesis search.
# Capturing an AssertionError from inside the property hands us the
# falsifying example without scraping Hypothesis's pytest-style
# reporter. derandomize=True + database=None makes the 300-example
# budget deterministic across browsers.
state = {"falsifying": None}

@given(st.decimals(min_value=MIN_, max_value=MAX_, places=PLACES))
@settings(
    max_examples=300,
    deadline=None,
    derandomize=True,
    database=None,
    suppress_health_check=list(HealthCheck),
)
def prop(d):
    if not (MIN_ <= d <= MAX_):
        if state["falsifying"] is None:
            state["falsifying"] = str(d)[:200]
        raise AssertionError(str(d)[:120])

try:
    prop()
except AssertionError:
    pass
except Exception as e:
    result["hypothesis_crash"] = f"{type(e).__name__}: {str(e)[:200]}"

result["hypothesis_falsifying"] = state["falsifying"]

# Approach B — manual strategy.example() sweep.
# Independent confirmation path: if Hypothesis's machinery itself
# misbehaves on WASM, the raw strategy output still tells us whether
# the bound-violation phenomenon survives.
strat = st.decimals(min_value=MIN_, max_value=MAX_, places=PLACES)
try:
    for _ in range(500):
        try:
            v = strat.example()
        except Exception:
            continue
        if not (MIN_ <= v <= MAX_):
            result["manual_violations"].append(str(v)[:200])
            if len(result["manual_violations"]) >= 3:
                break
except Exception as e:
    result["manual_crash"] = f"{type(e).__name__}: {str(e)[:200]}"

result["bound_violated"] = bool(result["hypothesis_falsifying"]) or bool(result["manual_violations"])
result
`.trim();

interface ReproOutput {
  hypothesis_version: string;
  python_version: string;
  min_value: string;
  max_value: string;
  places: number;
  hypothesis_falsifying: string | null;
  hypothesis_crash: string | null;
  manual_violations: string[];
  manual_crash: string | null;
  bound_violated: boolean;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<{
    toJs(opts: { dict_converter: typeof Object.fromEntries }): ReproOutput;
    destroy?(): void;
  }>;
}

interface WheelManifest {
  schema_version: number;
  package: string;
  filename: string;
  version: string;
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

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'hypothesis-4651: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
  );
}

if (!reproCodeEl.firstChild) {
  reproCodeEl.textContent = REPRO_CODE;
  fetch('./repro.highlighted.html')
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (html) reproCodeEl.innerHTML = html;
    })
    .catch(() => {});
}

function evaluate(result: ReproOutput): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (result.bound_violated) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — st.decimals(places=…) produced a Decimal outside the declared [min_value, max_value] bounds.',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — st.decimals stayed within bounds across the hypothesis search and manual sample sweep.',
  };
}

// Pyodide maps Python `None` to JS `undefined`, and `JSON.stringify`
// strips `undefined`-valued keys. Normalising here keeps both panels
// comparable at a glance (matches the astroid-2993 pattern).
function normalize(result: ReproOutput): ReproOutput {
  return {
    hypothesis_version: result.hypothesis_version,
    python_version: result.python_version,
    min_value: result.min_value,
    max_value: result.max_value,
    places: result.places,
    hypothesis_falsifying: result.hypothesis_falsifying ?? null,
    hypothesis_crash: result.hypothesis_crash ?? null,
    manual_violations: result.manual_violations ?? [],
    manual_crash: result.manual_crash ?? null,
    bound_violated: result.bound_violated,
  };
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const raw = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    const result = normalize(raw);
    const ev = evaluate(result);
    return {
      exitCode: 0,
      verdict: ev.verdict,
      message: ev.message,
      stdout: JSON.stringify(result, null, 2),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      verdict: 'unreproduced',
      message: `runtime error: ${message}`,
      stdout: message,
    };
  }
}

// Drop the in-memory hypothesis module tree so the next `import
// hypothesis` resolves the freshly-installed wheel rather than the
// previously-loaded version. Pyodide caches imports in `sys.modules`;
// `del` is the only reliable way to force a re-resolution after
// `micropip.uninstall`.
async function reinstallHypothesis(
  runtime: PyodideRuntime,
  installSpec: string,
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall("hypothesis")
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == "hypothesis" or n.startswith("hypothesis.")]:
    del sys.modules[_name]
await micropip.install(${JSON.stringify(installSpec)})
`);
}

const startedAt = new Date();

let baselineCapture: PathACapturedRun | null = null;
let baselineParsed: ReproOutput | null = null;
let fixCapture: PathACapturedRun | null = null;
let fixParsed: ReproOutput | null = null;
let manifest: WheelManifest | null = null;

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });
  const runtime = pyodide as PyodideRuntime;

  // Baseline variant: PyPI hypothesis==6.152.7.
  setVerdict('pending', 'Installing hypothesis==6.152.7 from PyPI…');
  await runtime.runPythonAsync(`
import micropip
await micropip.install("hypothesis==6.152.7")
`);

  setVerdict('pending', 'Running reproduction script (baseline)…');
  baselineCapture = await captureRun(runtime, REPRO_CODE);
  try {
    baselineParsed = JSON.parse(baselineCapture.stdout) as ReproOutput;
  } catch {
    baselineParsed = null;
  }
  outputBaselineEl.textContent = baselineCapture.stdout;

  // Build the Contract v1 envelope as a closure that reflects whatever
  // variant data is currently captured. Called once after baseline (so
  // `__VIVARIUM_RESULT__` is populated by the time the top-level
  // `#verdict` pill flips to "reproduced" — Playwright reads the
  // envelope at that moment and would otherwise see `undefined`), and
  // again after the fix-candidate run completes so the envelope picks
  // up the second variant.
  const buildEnvelope = (): VivariumResultV1 | null => {
    if (!baselineParsed || !baselineCapture) return null;
    const finishedAt = new Date();
    return {
      contract: 'v1',
      bug: {
        project: 'hypothesis',
        issue: 4651,
        upstream_url:
          'https://github.com/HypothesisWorks/hypothesis/issues/4651',
      },
      runtime: {
        name: 'pyodide',
        version,
        extras: {
          python: baselineParsed.python_version,
          hypothesis: baselineParsed.hypothesis_version,
          ...(fixParsed
            ? { hypothesis_fix_candidate: fixParsed.hypothesis_version }
            : {}),
        },
      },
      result: {
        min_value: baselineParsed.min_value,
        max_value: baselineParsed.max_value,
        places: baselineParsed.places,
        hypothesis_falsifying: baselineParsed.hypothesis_falsifying,
        manual_violation_count: baselineParsed.manual_violations.length,
        bound_violated: baselineParsed.bound_violated,
        baseline: {
          spec: 'hypothesis==6.152.7',
          verdict: baselineCapture.verdict,
          hypothesis_version: baselineParsed.hypothesis_version,
          hypothesis_falsifying: baselineParsed.hypothesis_falsifying,
          manual_violation_count: baselineParsed.manual_violations.length,
          bound_violated: baselineParsed.bound_violated,
        },
        fix_candidate:
          fixParsed && fixCapture && manifest
            ? {
                spec:
                  manifest.source.spec ??
                  `hypothesis @ git+${manifest.source.url}@${manifest.source.ref}` +
                    (manifest.source.subdirectory
                      ? `#subdirectory=${manifest.source.subdirectory}`
                      : ''),
                verdict: fixCapture.verdict,
                hypothesis_version: fixParsed.hypothesis_version,
                hypothesis_falsifying: fixParsed.hypothesis_falsifying,
                manual_violation_count: fixParsed.manual_violations.length,
                bound_violated: fixParsed.bound_violated,
                upstream_pr: manifest.upstream_pr || null,
              }
            : null,
      },
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      },
    };
  };

  // Publish the baseline-only envelope BEFORE flipping the verdict
  // pill — Playwright's regression suite reads `__VIVARIUM_RESULT__`
  // the moment `data-verdict` leaves `pending`.
  const initialEnvelope = buildEnvelope();
  if (initialEnvelope) setResult(initialEnvelope);

  // Top-level verdict pill mirrors baseline — preserves the
  // single-verdict Contract v1 surface for downstream consumers.
  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline hypothesis ${baselineParsed?.hypothesis_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} via Pyodide v${version}.`;

  // Fix-candidate variant: committed wheel.
  outputFixEl.textContent = 'Fetching wheel manifest…';
  let manifestRes: Response | null = null;
  try {
    manifestRes = await fetch('./wheels/manifest.json', { cache: 'no-store' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputFixEl.textContent = `Could not fetch wheel manifest: ${message}`;
  }

  if (manifestRes && manifestRes.ok) {
    manifest = (await manifestRes.json()) as WheelManifest;
    const wheelUrl = new URL(
      `./wheels/${manifest.filename}`,
      window.location.href,
    ).toString();
    outputFixEl.textContent =
      `Installing ${manifest.filename} (${manifest.version})…\n` +
      `from ${manifest.source.url}@${manifest.source.ref}` +
      (manifest.source.subdirectory
        ? ` (subdir: ${manifest.source.subdirectory})`
        : '');
    try {
      await reinstallHypothesis(runtime, wheelUrl);
      fixCapture = await captureRun(runtime, REPRO_CODE);
      try {
        fixParsed = JSON.parse(fixCapture.stdout) as ReproOutput;
      } catch {
        fixParsed = null;
      }
      outputFixEl.textContent = fixCapture.stdout;
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      outputFixEl.textContent = `Fix-candidate install/run failed: ${message}`;
    }
  } else if (manifestRes && !manifestRes.ok) {
    outputFixEl.textContent = `Wheel manifest unavailable (HTTP ${manifestRes.status}).`;
  }

  // Restore baseline hypothesis so the visitor-facing runner (Edit +
  // Run) operates against the buggy build — the runner's documented
  // mental model is "test your script change against the same broken
  // interpreter the recipe loaded". Without this, runner.runFix would
  // execute against the fix-candidate hypothesis, which is
  // semantically surprising for visitors paste-editing the script.
  try {
    await reinstallHypothesis(runtime, 'hypothesis==6.152.7');
  } catch {
    console.warn(
      'hypothesis-4651: failed to restore baseline for the runner; runner.runFix will run against the fix-candidate.',
    );
  }

  // ---- Contract v1 envelope (final) ---------------------------------
  // Re-publish the envelope now that the fix-candidate variant has
  // also captured (or definitively failed). `result` keeps the
  // historical baseline-only fields so consumers reading
  // `__VIVARIUM_RESULT__.result.bound_violated` continue to work,
  // and the additive `baseline` / `fix_candidate` sub-objects
  // describe each variant separately. Additive change — no
  // `contract` version bump.
  const finalEnvelope = buildEnvelope();
  if (finalEnvelope) setResult(finalEnvelope);

  enableRunner({
    slug: 'hypothesis-4651',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputBaselineEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
