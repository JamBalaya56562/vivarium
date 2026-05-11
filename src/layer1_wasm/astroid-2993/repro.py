# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "astroid==4.1.2",
# ]
# ///
"""Vivarium Layer 1 reproduction — pylint-dev/astroid#2993, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real astroid build:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/astroid-2993/repro.py

PEP 723 inline metadata pins **astroid 4.1.2** — the latest release at
authoring time. `uv run` reads the metadata and creates an ephemeral
venv on first invocation; subsequent runs hit uv's cache.

The fuzzed inputs are assignment and function type comments whose
values are ``i`` followed by 200 unclosed ``{`` characters. Older
astroid versions hand the comments to CPython's parser and leak the
resulting ``MemoryError``. The fix candidate should detect this
pathological nesting before parsing, skip the invalid type comment, and
still parse deeply nested but valid type comments.

Exits 0 on `pass` (bug REPRODUCED — a pathological type comment
crashed astroid), 1 on `fail` (bug not reproduced — both pathological
comments were skipped and the valid deep-nesting control still parsed).
"""

import json
import sys

import astroid

NESTED = 200
VALID_DEPTH = 20


def case_result(name: str, code: str, inspect) -> dict[str, object]:
    out: dict[str, object] = {
        "name": name,
        "exception_type": None,
        "exception_message": None,
        "crashed": False,
    }
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


def inspect_assignment(module) -> dict[str, object]:
    return {"type_annotation_is_none": module.body[0].type_annotation is None}


def inspect_function(module) -> dict[str, object]:
    node = module.body[0]
    return {
        "type_comment_returns_is_none": node.type_comment_returns is None,
        "type_comment_args_is_none": node.type_comment_args is None,
    }


def inspect_valid_assignment(module) -> dict[str, object]:
    return {"type_annotation_is_present": module.body[0].type_annotation is not None}


assignment_code = "a = b # type:i" + "{" * NESTED
function_code = "def func():\n    # type: i" + "{" * NESTED + "\n    pass\n"
valid_inner = "List[" * VALID_DEPTH + "int" + "]" * VALID_DEPTH
valid_code = f"a = b # type: {valid_inner}"

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

result = {
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
    "cases": {
        "assignment": assignment,
        "function": function,
        "valid_control": valid_control,
    },
}

print(json.dumps(result, indent=2))

if crashed:
    print(
        f"verdict=reproduced — astroid.builder.parse raised "
        f"{result['exception_type']} on a pathological type comment",
        file=sys.stderr,
    )
    sys.exit(0)
elif skipped_pathological and valid_control_parsed:
    print(
        "verdict=unreproduced — astroid skipped pathological type "
        "comments before parsing and kept valid deep nesting intact",
        file=sys.stderr,
    )
    sys.exit(1)
else:
    print(
        "verdict=unreproduced — astroid no longer crashes, but the "
        "pathological-skip or valid-control assertions did not all pass",
        file=sys.stderr,
    )
    sys.exit(1)
