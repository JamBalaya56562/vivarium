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

The fuzzed input is a single-line assignment with a type comment
``# type:i{{{...{{`` whose value is `i` followed by a long run of
``{`` characters. CPython's compiler walks the type-comment expression
recursively and either runs out of stack (RecursionError) or memory
(MemoryError); astroid does not catch either, so the exception
propagates out of ``astroid.builder.parse``. The expected fix —
mirroring the f-string fix in #2762 / 4.1.2 — is for astroid to catch
the runtime error in its type-comment parser and treat the comment as
opaque.

Exits 0 on `pass` (bug REPRODUCED — astroid raised), 1 on `fail` (bug
not reproduced — astroid returned cleanly or raised the expected
``AstroidSyntaxError``).
"""

import json
import sys

import astroid

# ~270 nested `{` mirrors the fuzz from the upstream issue; in CPython
# 3.13 this exceeds the compiler's stack budget. Pyodide WASM hits the
# same threshold because it uses the same CPython source.
NESTED = 270
CODE = "a=b # type:i" + "{" * NESTED

result = {
    "astroid_version": astroid.__version__,
    "python_version": sys.version.split()[0],
    "nested_braces": NESTED,
    "exception_type": None,
    "exception_message": None,
    "crashed": False,
}

try:
    astroid.builder.parse(CODE)
except astroid.exceptions.AstroidSyntaxError as e:
    # Graceful: astroid wrapped the underlying SyntaxError in its own
    # exception type. Not the bug.
    result["exception_type"] = "AstroidSyntaxError"
    result["exception_message"] = str(e)[:200]
except (MemoryError, RecursionError) as e:
    # The bug: astroid leaked the underlying CPython runtime error
    # instead of catching it the way #2762 / 4.1.2 did for f-strings.
    result["exception_type"] = type(e).__name__
    result["exception_message"] = str(e)[:200]
    result["crashed"] = True
except Exception as e:
    # Any other unhandled exception is also the bug — astroid should
    # not surface arbitrary parser errors to its callers.
    result["exception_type"] = type(e).__name__
    result["exception_message"] = str(e)[:200]
    result["crashed"] = True

print(json.dumps(result, indent=2))

if result["crashed"]:
    print(
        f"verdict=reproduced — astroid.builder.parse raised "
        f"{result['exception_type']} on a fuzzed type comment",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — astroid handled the fuzzed type comment "
        "without an unhandled runtime error (likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
