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
2. ``fix-candidate`` — the fork+branch opened as upstream PR #3049
   (currently ``JamBalaya56562/astroid@claude/fix-astroid-2993-wVitv``);
   should flip to ``unreproduced`` by skipping pathological type
   comments before parsing while still parsing valid deep nesting.

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

NESTED = 200
VALID_DEPTH = 20

VARIANTS: list[dict[str, str]] = [
    {
        "name": "baseline",
        "label": "PyPI astroid==4.1.2 (pre-fix)",
        "spec": "astroid==4.1.2",
        "expected": "reproduced",
    },
    {
        "name": "fix-candidate",
        "label": "pylint-dev/astroid#3049",
        "spec": (
            "astroid @ git+https://github.com/JamBalaya56562/astroid"
            "@claude/fix-astroid-2993-wVitv"
        ),
        "expected": "unreproduced",
    },
]

# Per-variant probe; runs in a uv-managed ephemeral venv that has the
# variant's astroid spec installed. Mirrors repro.py's exception
# taxonomy and fixed-behavior assertions so the per-variant verdicts
# are directly comparable.
PROBE = textwrap.dedent(
    f"""
    import json, sys
    import astroid

    NESTED = {NESTED}
    VALID_DEPTH = {VALID_DEPTH}

    def case_result(name, code, inspect):
        out = {{
            "name": name,
            "exception_type": None,
            "exception_message": None,
            "crashed": False,
        }}
        try:
            module = astroid.builder.parse(code)
            out.update(inspect(module))
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
        return out

    def inspect_assignment(module):
        return {{"type_annotation_is_none": module.body[0].type_annotation is None}}

    def inspect_function(module):
        node = module.body[0]
        return {{
            "type_comment_returns_is_none": node.type_comment_returns is None,
            "type_comment_args_is_none": node.type_comment_args is None,
        }}

    def inspect_valid_assignment(module):
        return {{"type_annotation_is_present": module.body[0].type_annotation is not None}}

    assignment_code = "a = b # type:i" + "{{" * NESTED
    function_code = "def func():\\n    # type: i" + "{{" * NESTED + "\\n    pass\\n"
    valid_inner = "List[" * VALID_DEPTH + "int" + "]" * VALID_DEPTH
    valid_code = f"a = b # type: {{valid_inner}}"

    assignment = case_result("pathological_assignment", assignment_code, inspect_assignment)
    function = case_result("pathological_function", function_code, inspect_function)
    valid_control = case_result("valid_deep_nesting", valid_code, inspect_valid_assignment)

    pathological_cases = [assignment, function]
    crashed = any(bool(case["crashed"]) for case in pathological_cases)
    skipped_pathological = (
        assignment.get("type_annotation_is_none") is True
        and function.get("type_comment_returns_is_none") is True
        and function.get("type_comment_args_is_none") is True
    )
    valid_control_parsed = valid_control.get("type_annotation_is_present") is True

    out = {{
        "astroid_version": astroid.__version__,
        "python_version": sys.version.split()[0],
        "nested_braces": NESTED,
        "valid_depth": VALID_DEPTH,
        "exception_type": next(
            (case["exception_type"] for case in pathological_cases if case["crashed"]),
            None,
        ),
        "crashed": crashed,
        "skipped_pathological": skipped_pathological,
        "valid_control_parsed": valid_control_parsed,
        "cases": {{
            "assignment": assignment,
            "function": function,
            "valid_control": valid_control,
        }},
    }}

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
    record["fixed_assertions_passed"] = (
        result.get("skipped_pathological") is True
        and result.get("valid_control_parsed") is True
    )
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
    assertion_failures = [
        v
        for v in variants
        if v["name"] == "fix-candidate" and v.get("fixed_assertions_passed") is not True
    ]
    mismatches.extend(assertion_failures)
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
        "the fix candidate skips pathological type comments before parsing.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
