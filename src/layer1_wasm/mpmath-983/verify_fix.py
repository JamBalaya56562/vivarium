# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Vivarium Layer 1 — mpmath#983 fix-candidate verification (native).

Sibling of ``repro.py``. Where ``repro.py`` runs the reproduction
against **one** mpmath build (the canonical bug-still-present pin),
this orchestrator runs it against **two** builds in side-by-side
ephemeral venvs:

1. ``baseline`` — ``mpmath==1.4.1`` from PyPI (the latest release at
   authoring time; the bug still reproduces here).
2. ``fix-candidate`` — the fork+branch ``JamBalaya56562/mpmath
   @claude/fix-mpmath-issue-983-y1k7X``; should flip to
   ``unreproduced`` once the Householder QR guard no longer trips on a
   well-conditioned system.

The output is a single JSON envelope on stdout listing both verdicts,
so a maintainer can see the **before / after** of the candidate fix in
one invocation. The exit code is ``0`` iff every variant matches its
expected verdict (baseline reproduces AND fix-candidate does not);
anything else is treated as a regression.

This script does **not** ship a Vivarium Contract v1 surface — it is a
maintainer convenience tool. The canonical Contract v1 verdict for
this recipe is the live one published by ``index.html`` (and mirrored
by ``repro.py`` for native runs against a single build). Once an
upstream-merged release lands on PyPI, bump the pin in ``repro.py`` /
``repro.ts`` and delete this script.

Run:

    mise install                                                          # one-time
    mise exec uv -- uv run src/layer1_wasm/mpmath-983/verify_fix.py
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
        "label": "PyPI mpmath==1.4.1 (pre-fix)",
        "spec": "mpmath==1.4.1",
        "expected": "reproduced",
    },
    {
        "name": "fix-candidate",
        "label": "JamBalaya56562/mpmath@claude/fix-mpmath-issue-983-y1k7X",
        "spec": (
            "mpmath @ git+https://github.com/JamBalaya56562/mpmath"
            "@claude/fix-mpmath-issue-983-y1k7X"
        ),
        "expected": "unreproduced",
    },
]

# Per-variant probe; runs in a uv-managed ephemeral venv that has the
# variant's mpmath spec installed. Mirrors repro.py's exception
# taxonomy so the per-variant verdicts are directly comparable.
PROBE = textwrap.dedent(
    """
    import json, sys
    import mpmath
    from mpmath import mp

    A = mp.matrix([
        [mp.one, -mp.pi / 20, (-mp.pi / 20) ** 2, (-mp.pi / 20) ** 3],
        [mp.one, mp.zero, mp.zero, mp.zero],
        [mp.one, mp.pi / 20, (mp.pi / 20) ** 2, (mp.pi / 20) ** 3],
        [mp.one, mp.pi / 10, (mp.pi / 10) ** 2, (mp.pi / 10) ** 3],
    ])
    b = mp.matrix([
        [mp.sin(-mp.pi / 20)],
        [mp.zero],
        [mp.sin(mp.pi / 20)],
        [mp.sin(mp.pi / 20)],
    ])

    out = {
        "mpmath_version": mpmath.__version__,
        "python_version": sys.version.split()[0],
        "mp_dps": mp.dps,
        "qr_solve_raised": False,
        "qr_solve_error": None,
        "lu_solve_succeeded": False,
        "lu_solve_solution": None,
        "asymmetry": False,
    }

    try:
        mp.qr_solve(A, b)
    except ValueError as e:
        out["qr_solve_raised"] = True
        out["qr_solve_error"] = str(e)[:200]

    try:
        x_lu = mp.lu_solve(A, b)
        out["lu_solve_succeeded"] = True
        out["lu_solve_solution"] = [mp.nstr(x_lu[i, 0], 6) for i in range(4)]
    except Exception as e:
        out["lu_solve_solution"] = (
            f"lu_solve also raised: {type(e).__name__}: {str(e)[:120]}"
        )

    out["asymmetry"] = out["qr_solve_raised"] and out["lu_solve_succeeded"]

    print(json.dumps(out))
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
    record["verdict"] = "reproduced" if result["asymmetry"] else "unreproduced"
    return record


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    variants = [run_variant(v) for v in VARIANTS]
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    envelope = {
        "tool": "vivarium-mpmath-983-fix-verification",
        "schema_version": "internal-1",
        "bug": {
            "project": "mpmath",
            "issue": 983,
            "upstream_url": "https://github.com/mpmath/mpmath/issues/983",
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
        "the fix candidate no longer flags the well-conditioned system as singular.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
