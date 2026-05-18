# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Vivarium Layer 1 — lark#1585 fix-candidate verification (native).

Sibling of ``repro.py``. Where ``repro.py`` runs the reproduction
against **one** lark build (the canonical bug-still-present pin),
this orchestrator runs it against **two** builds in side-by-side
ephemeral venvs:

1. ``baseline`` — ``lark==1.3.1`` from PyPI (the build under which
   the LALR/CYK infinite loop was confirmed; should still
   ``reproduced`` — i.e. the child subprocess hangs past the 8 s
   budget).
2. ``fix-candidate`` — the fork+branch carrying the proposed fix
   (currently
   ``JamBalaya56562/lark@claude/fix-lark-1585-QLVa7``); should
   flip to ``unreproduced`` by letting
   ``Lark('start.1: "a" | start start*', parser='lalr').parse('aa')``
   return a parse tree within the budget.

The output is a single JSON envelope on stdout listing both
verdicts, so a maintainer can see the **before / after** of the
candidate fix in one invocation. The exit code is ``0`` iff every
variant matches its expected verdict (baseline reproduces AND
fix-candidate does not); anything else is treated as a regression.

Because the bug is a hang rather than a wrong result, each variant
is launched as a fresh ``uv run --no-project`` subprocess and the
parent waits with ``subprocess.TimeoutExpired`` so the hung child
can be reaped without depending on ``signal.alarm`` (Windows-
friendly).

This script does **not** ship a Vivarium Contract v1 surface — it
is a maintainer convenience tool. The canonical Contract v1
verdict for this recipe is the live one published by
``index.html`` (and mirrored by ``repro.py`` for native runs
against a single build). Once an upstream-merged release lands on
PyPI, bump the pin in ``repro.py`` / ``repro.ts`` and delete this
script.

Run:

    mise install                                                          # one-time
    mise exec uv -- uv run src/layer1_wasm/lark-1585/verify_fix.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import time
from datetime import datetime, timezone

TIMEOUT_S = 8.0

VARIANTS: list[dict[str, str]] = [
    {
        "name": "baseline",
        "label": "PyPI lark==1.3.1 (pre-fix)",
        "spec": "lark==1.3.1",
        "expected": "reproduced",
    },
    {
        "name": "fix-candidate",
        "label": "JamBalaya56562/lark@claude/fix-lark-1585-QLVa7",
        "spec": ("lark @ git+https://github.com/JamBalaya56562/lark@claude/fix-lark-1585-QLVa7"),
        "expected": "unreproduced",
    },
]

# Per-variant probe; runs in a uv-managed ephemeral venv that has
# the variant's lark spec installed. Mirrors repro.py's parse call
# so the per-variant verdicts are directly comparable. The probe
# prints lark + python versions to stderr immediately (so the
# parent can recover them even when the parse itself hangs and the
# child is killed), then runs the parse.
PROBE = textwrap.dedent(
    """
    import sys
    import lark
    from lark import Lark

    print(lark.__version__, sys.version.split()[0], flush=True, file=sys.stderr)
    Lark('start.1: "a" | start start*', parser='lalr').parse('aa')
    """
).strip()


def run_variant(variant: dict[str, str]) -> dict[str, object]:
    """Run the probe inside an ephemeral uv venv with *spec* installed."""
    print(f"\n--- {variant['name']} :: {variant['label']} ---", file=sys.stderr)
    started = time.perf_counter()
    record: dict[str, object] = {
        "name": variant["name"],
        "label": variant["label"],
        "spec": variant["spec"],
        "expected": variant["expected"],
        "timeout_ms": TIMEOUT_S * 1000,
    }
    try:
        completed = subprocess.run(
            [
                "uv",
                "run",
                "--no-project",
                "--python",
                "3.13",
                "--with",
                variant["spec"],
                "--",
                "python",
                "-c",
                PROBE,
            ],
            timeout=TIMEOUT_S,
            capture_output=True,
            text=True,
            check=False,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        child_meta = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else ""
        lark_version, _, python_version = child_meta.partition(" ")
        record.update(
            {
                "lark_version": lark_version or "unknown",
                "python_version": python_version or sys.version.split()[0],
                "outcome": "returned" if completed.returncode == 0 else "raised",
                "exit_code": completed.returncode,
                "stderr_tail": (completed.stderr or "").splitlines()[-5:],
                "elapsed_ms": elapsed_ms,
                "verdict": "unreproduced",
            }
        )
        if completed.returncode == 0:
            record["message"] = "Lark(...).parse('aa') returned cleanly within the budget."
        else:
            record["message"] = (
                "child raised before timeout "
                f"(exit {completed.returncode}); the infinite loop reported "
                "upstream did not trigger."
            )
        return record
    except subprocess.TimeoutExpired as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        stderr_str = exc.stderr.decode(errors="replace") if exc.stderr else ""
        child_meta = stderr_str.strip().splitlines()[-1] if stderr_str.strip() else ""
        lark_version, _, python_version = child_meta.partition(" ")
        record.update(
            {
                "lark_version": lark_version or "1.3.1",
                "python_version": python_version or sys.version.split()[0],
                "outcome": "timeout",
                "exit_code": None,
                "stderr_tail": stderr_str.splitlines()[-5:],
                "elapsed_ms": elapsed_ms,
                "verdict": "reproduced",
                "message": (
                    f"Lark(...).parse('aa') hung past {TIMEOUT_S:.0f}s; "
                    "the LALR back-end exhibits the infinite loop reported "
                    "upstream."
                ),
            }
        )
        return record


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    variants = [run_variant(v) for v in VARIANTS]
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    baseline = next(v for v in variants if v["name"] == "baseline")
    fix = next(v for v in variants if v["name"] == "fix-candidate")

    ok = baseline["verdict"] == baseline["expected"] and fix["verdict"] == fix["expected"]

    envelope = {
        "tool": "vivarium-lark-1585-fix-verification",
        "schema_version": "internal-1",
        "bug": {
            "project": "lark",
            "issue": 1585,
            "upstream_url": "https://github.com/lark-parser/lark/issues/1585",
        },
        "started_at": started_at,
        "finished_at": finished_at,
        "ok": ok,
        "verdict": ("fix-candidate-confirmed" if ok else "fix-candidate-rejected"),
        "summary": (
            f"baseline {baseline['verdict']} (expected {baseline['expected']}), "
            f"fix-candidate {fix['verdict']} (expected {fix['expected']})"
        ),
        "variants": variants,
    }
    print(json.dumps(envelope, indent=2))

    if not ok:
        mismatches = [v for v in variants if v["verdict"] != v["expected"]]
        print(
            "\nverdict=fix-candidate-rejected — variants did not match "
            "expected verdicts: "
            + ", ".join(
                f"{v['name']} expected={v['expected']} got={v['verdict']}" for v in mismatches
            ),
            file=sys.stderr,
        )
        return 1

    print(
        "\nverdict=fix-candidate-confirmed — baseline still hangs past "
        f"{TIMEOUT_S:.0f}s and the fix candidate returns a parse tree within "
        "the budget.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
