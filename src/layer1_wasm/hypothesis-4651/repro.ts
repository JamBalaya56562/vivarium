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
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — a Hypothesis search or a manual `strategy.example()`
//     sweep produced at least one `Decimal` outside `[MIN, MAX]`.
//   - "unreproduced" — both signal paths returned empty (the strategy
//     respected its declared bounds on every sample), or the runtime
//     errored before producing a result.
//
// hypothesis is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. hypothesis is pure
// Python and pulls in `attrs` + `sortedcontainers` as transitive
// dependencies — all single pure-Python wheels from PyPI.

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

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'hypothesis-4651: missing required DOM elements (#output, #meta, #repro-code).',
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

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const result = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
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

const startedAt = new Date();

try {
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });

  setVerdict('pending', 'Installing hypothesis from PyPI…');
  const runtime = pyodide as PyodideRuntime;
  await runtime.runPythonAsync(`
import micropip
await micropip.install("hypothesis==6.152.7")
`);

  setVerdict('pending', 'Running reproduction script…');
  const baseline = await captureRun(runtime, REPRO_CODE);

  let baselineResult: ReproOutput | null = null;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    outputEl.textContent = baseline.stdout;
    setVerdict(baseline.verdict, baseline.message);
    throw new Error(baseline.message);
  }

  metaEl.textContent =
    `hypothesis ${baselineResult.hypothesis_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'hypothesis',
      issue: 4651,
      upstream_url: 'https://github.com/HypothesisWorks/hypothesis/issues/4651',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        hypothesis: baselineResult.hypothesis_version,
      },
    },
    result: {
      min_value: baselineResult.min_value,
      max_value: baselineResult.max_value,
      places: baselineResult.places,
      hypothesis_falsifying: baselineResult.hypothesis_falsifying,
      manual_violation_count: baselineResult.manual_violations.length,
      bound_violated: baselineResult.bound_violated,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'hypothesis-4651',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
