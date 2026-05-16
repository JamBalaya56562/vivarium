# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Vivarium Layer 1 — hypothesis#4651 fix-candidate verification (native).

Sibling of `repro.py`. Where `repro.py` runs the reproduction against
**one** hypothesis build (the canonical bug-still-present pin), this
orchestrator runs it against **two** builds in side-by-side ephemeral
venvs:

1. ``baseline`` — ``hypothesis==6.152.7`` from PyPI (the build under
   which the bug was confirmed; should still ``reproduced``).
2. ``fix-candidate`` — the fork+branch carrying the proposed fix
   (currently
   ``JamBalaya56562/hypothesis@fix-decimals-places-bounds`` with the
   installable package under ``hypothesis-python/``); should flip to
   ``unreproduced`` by keeping every ``st.decimals(places=…)`` sample
   inside the declared bounds.

The output is a single JSON envelope on stdout listing both verdicts,
so a maintainer can see the **before / after** of the candidate fix
in one invocation. The exit code is ``0`` iff every variant matches
its expected verdict (baseline reproduces AND fix-candidate does not);
anything else is treated as a regression.

This script does **not** ship a Vivarium Contract v1 surface — it is a
maintainer convenience tool. The canonical Contract v1 verdict for
this recipe is the live one published by ``index.html`` (and mirrored
by ``repro.py`` for native runs against a single build). Once an
upstream-merged release lands on PyPI, bump the pin in ``repro.py`` /
``repro.ts`` and delete this script.

Run:

    mise install                                                          # one-time
    mise exec uv -- uv run src/layer1_wasm/hypothesis-4651/verify_fix.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from datetime import datetime, timezone

VARIANTS: list[dict[str, str]] = [
    {
        "name": "baseline",
        "label": "PyPI hypothesis==6.152.7 (pre-fix)",
        "spec": "hypothesis==6.152.7",
        "expected": "reproduced",
    },
    {
        "name": "fix-candidate",
        "label": "JamBalaya56562/hypothesis@fix-decimals-places-bounds",
        "spec": (
            "hypothesis @ git+https://github.com/JamBalaya56562/hypothesis"
            "@fix-decimals-places-bounds"
            "#subdirectory=hypothesis-python"
        ),
        "expected": "unreproduced",
    },
]

# Per-variant probe; runs in a uv-managed ephemeral venv that has the
# variant's hypothesis spec installed. Mirrors repro.py's bound-check
# logic so the per-variant verdicts are directly comparable.
PROBE = textwrap.dedent(
    """
    import json, sys
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

    print(json.dumps(result))
    """
).strip()


def run_variant(variant: dict[str, str]) -> dict[str, object]:
    print(f"\n--- {variant['name']} :: {variant['label']} ---", file=sys.stderr)
    proc = subprocess.run(
        [
            "uv",
            "run",
            "--no-project",
            "--with",
            variant["spec"],
            "python",
            "-c",
            PROBE,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    record: dict[str, object] = {
        "name": variant["name"],
        "label": variant["label"],
        "spec": variant["spec"],
        "expected": variant["expected"],
    }
    stdout = proc.stdout.strip()
    if proc.returncode != 0 and not stdout:
        record["error"] = (
            f"uv run exited {proc.returncode}; "
            f"stderr tail: {proc.stderr[-400:]!r}"
        )
        record["verdict"] = "unreproduced"
        return record
    try:
        result = json.loads(stdout.splitlines()[-1])
    except (ValueError, IndexError):
        record["error"] = f"probe stdout was not JSON; stdout tail: {stdout[-400:]!r}"
        record["verdict"] = "unreproduced"
        return record
    record.update(result)
    record["verdict"] = "reproduced" if result["bound_violated"] else "unreproduced"
    return record


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    variants = [run_variant(v) for v in VARIANTS]
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    envelope = {
        "tool": "vivarium-hypothesis-4651-fix-verification",
        "schema_version": "internal-1",
        "bug": {
            "project": "hypothesis",
            "issue": 4651,
            "upstream_url": "https://github.com/HypothesisWorks/hypothesis/issues/4651",
        },
        "started_at": started_at,
        "finished_at": finished_at,
        "variants": variants,
    }
    print(json.dumps(envelope, indent=2))

    mismatches = [v for v in variants if v["verdict"] != v["expected"]]
    if mismatches:
        print(
            "\nverdict=mismatch — variants did not match expected verdicts: "
            + ", ".join(
                f"{v['name']} expected={v['expected']} got={v['verdict']}"
                for v in mismatches
            ),
            file=sys.stderr,
        )
        return 1

    print(
        "\nverdict=fix-candidate-confirmed — baseline still reproduces and "
        "the fix candidate keeps st.decimals(places=…) inside the declared bounds.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
