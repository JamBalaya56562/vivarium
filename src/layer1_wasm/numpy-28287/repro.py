# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "numpy==2.2.5",
# ]
# ///
"""Vivarium Layer 1 reproduction — numpy/numpy#28287, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real NumPy build:

    mise install                                                  # one-time
    mise exec uv -- uv run src/layer1_wasm/numpy-28287/repro.py

PEP 723 inline metadata pins numpy to **2.2.5** — the exact version
Pyodide v0.29.3 ships — so the page and this CLI exercise the same
code path.

Prints `pass` if the bug REPRODUCES (`timedelta64` ordering is
non-transitive across the generic unit), `fail` otherwise. Exit
code: 0 on `pass`, 1 on `fail`.
"""

import json
import sys

import numpy as np

x = np.timedelta64(1, "ms")
y = np.timedelta64(2)
z = np.timedelta64(5, "ns")

x_lt_y = bool(x < y)
y_lt_z = bool(y < z)
x_lt_z = bool(x < z)
transitivity_violated = x_lt_y and y_lt_z and not x_lt_z

result = {
    "numpy_version": np.__version__,
    "python_version": sys.version.split()[0],
    "x_lt_y": x_lt_y,
    "y_lt_z": y_lt_z,
    "x_lt_z": x_lt_z,
    "transitivity_violated": transitivity_violated,
    "reproduced": transitivity_violated,
}

print(json.dumps(result, indent=2))

if transitivity_violated:
    print(
        "verdict=reproduced — timedelta64 ordering is non-transitive (x < y < z but x ≥ z)",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — timedelta64 ordering is transitive (likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
