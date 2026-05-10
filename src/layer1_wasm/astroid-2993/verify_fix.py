# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Vivarium Layer 1 — astroid#2993 fix-candidate verification (native).

Sibling of `repro.py`. Where `repro.py` runs the reproduction against
**one** astroid build (the canonical bug-still-present pin), this
orchestrator runs it against **two** builds in side-by-side ephemeral
venvs:

1. ``baseline`` — ``astroid==4.1.2`` from PyPI (the build under which
   the bug was filed; should still ``reproduced``).
2. ``fix-candidate`` — a fork+branch the upstream PR is opened from
   (currently ``JamBalaya56562/astroid@claude/fix-astroid-2993-wVitv``);
   should flip to ``unreproduced``.

The output is a single JSON envelope on stdout listing both verdicts,
so a maintainer can see the **before / after** of the candidate fix in
one invocation. The exit code is ``0`` iff every variant matches its
expected verdict (baseline reproduces AND fix-candidate does not);
anything else is treated as a regression.

This script does **not** ship a Vivarium Contract v1 surface — it is a
maintainer convenience tool. The canonical Contract v1 verdict for this
recipe is the live one published by ``index.html`` (and mirrored by
``repro.py`` for native runs against a single build). Once an
upstream-merged release lands on PyPI, bump the pin in ``repro.py`` /
``repro.ts`` and delete this script.

Run:

    mise install                                                          # one-time
    mise exec uv -- uv run src/layer1_wasm/astroid-2993/verify_fix.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from datetime import datetime, timezone

NESTED = 270

VARIANTS: list[dict[str, str]] = [
    {
        "name": "baseline",
        "label": "PyPI astroid==4.1.2 (pre-fix)",
        "spec": "astroid==4.1.2",
        "expected": "reproduced",
    },
    {
        "name": "fix-candidate",
        "label": "JamBalaya56562/astroid@claude/fix-astroid-2993-wVitv",
        "spec": (
            "astroid @ git+https://github.com/JamBalaya56562/astroid"
            "@claude/fix-astroid-2993-wVitv"
        ),
        "expected": "unreproduced",
    },
]

# Per-variant probe; runs in a uv-managed ephemeral venv that has the
# variant's astroid spec installed. Mirrors repro.py's exception
# taxonomy so the per-variant verdicts are directly comparable.
PROBE = textwrap.dedent(
    f"""
    import json, sys
    import astroid

    NESTED = {NESTED}
    code = "a=b # type:i" + "{{" * NESTED

    out = {{
        "astroid_version": astroid.__version__,
        "python_version": sys.version.split()[0],
        "nested_braces": NESTED,
        "exception_type": None,
        "exception_message": None,
        "crashed": False,
    }}
    try:
        astroid.builder.parse(code)
    except astroid.exceptions.AstroidSyntaxError as e:
        out["exception_type"] = "AstroidSyntaxError"
        out["exception_message"] = str(e)[:200]
    except (MemoryError, RecursionError) as e:
        out["exception_type"] = type(e).__name__
        out["exception_message"] = str(e)[:200]
        out["crashed"] = True
    except Exception as e:
        out["exception_type"] = type(e).__name__
        out["exception_message"] = str(e)[:200]
        out["crashed"] = True

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
    record["verdict"] = "reproduced" if result["crashed"] else "unreproduced"
    return record


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    variants = [run_variant(v) for v in VARIANTS]
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    envelope = {
        "tool": "vivarium-astroid-2993-fix-verification",
        "schema_version": "internal-1",
        "bug": {
            "project": "astroid",
            "issue": 2993,
            "upstream_url": "https://github.com/pylint-dev/astroid/issues/2993",
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
        "the fix candidate flips the verdict to unreproduced.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
