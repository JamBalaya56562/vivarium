# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "sympy==1.14.0",
# ]
# ///
"""Vivarium Layer 1 reproduction — sympy/sympy#29413, native variant.

Mirrors the script that runs in ``repro.ts`` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real sympy install:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/sympy-29413/repro.py

PEP 723 inline metadata pins sympy to **1.14.0** — the version
reported as exhibiting the bug in the upstream issue thread.

``ask(a + 1 > a, Q.extended_real(a))`` should be ``None`` (the
predicate is undefined when ``a = ±oo``, which ``extended_real``
admits). sympy 1.14.0 returns ``True``. Verdict is "reproduced"
when the returned value is literally ``True``.

Prints ``reproduced=true`` to JSON output. Exit code: 0 on
``reproduced``, 1 on ``unreproduced`` so CI can shell-script around
it without parsing stdout.
"""

import json
import sys

import sympy
from sympy import Q, Symbol, ask

a = Symbol("a")
result_value = ask(a + 1 > a, Q.extended_real(a))

# Bug: sympy 1.14.0 returns True. Correct answer is None (a = ±oo
# is within extended_real and makes a + 1 > a undefined).
reproduced = result_value is True

result = {
    "sympy_version": sympy.__version__,
    "python_version": sys.version.split()[0],
    "ask_result": repr(result_value),
    "expected": "None (undefined when a = ±oo)",
    "reproduced": reproduced,
}

print(json.dumps(result, indent=2))

if reproduced:
    print(
        "verdict=reproduced — ask(a+1>a, Q.extended_real(a)) returned True, "
        "but a=±oo would make this undefined.",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — assumption no longer claims True for "
        "(a+1)>a under extended_real (likely fixed upstream).",
        file=sys.stderr,
    )
    sys.exit(1)
