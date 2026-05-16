# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "hypothesis==6.152.7",
# ]
# ///
"""Vivarium Layer 1 reproduction — HypothesisWorks/hypothesis#4651, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real hypothesis build:

    mise install                                                       # one-time
    mise exec uv -- uv run src/layer1_wasm/hypothesis-4651/repro.py

PEP 723 inline metadata pins **hypothesis 6.152.7** — the latest
release at authoring time (2026-05-16). `uv run` reads the metadata
and creates an ephemeral venv on first invocation; subsequent runs
hit uv's cache.

The bug: `st.decimals(min_value, max_value, places=N)` returns
`Decimal` values that exceed the declared bounds when both bounds
have many significant digits. The internal `ctx(val)` helper
(`hypothesis/strategies/_internal/core.py:1811`) derives precision
from `math.log10(abs(val))`, which collapses to 1 for tiny values
like `Decimal("0." + "0" * 63 + "1")` — and at precision 1 the
quantising divide loses essentially all the coefficient's digits.

Exits 0 on `pass` (bug REPRODUCED — at least one sample violated
the declared bounds), 1 on `fail` (the strategy respected its
bounds across both signal paths, likely fixed upstream).
"""

import json
import sys
from decimal import Decimal

import hypothesis
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

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

# Approach A — bounded Hypothesis search. Capturing an AssertionError
# from inside the property hands us the falsifying example without
# having to scrape Hypothesis's pytest-style reporter.
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

# Approach B — manual strategy.example() sweep. Independent
# confirmation path: even if Hypothesis's full @given machinery is
# unreliable for any reason, the raw strategy output still shows
# whether the bound-violation phenomenon survives.
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

result["bound_violated"] = bool(result["hypothesis_falsifying"]) or bool(
    result["manual_violations"]
)

print(json.dumps(result, indent=2))

if result["bound_violated"]:
    print(
        "verdict=reproduced — st.decimals(places=…) produced a Decimal outside the declared bounds",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — st.decimals stayed within bounds across both signal paths (likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
