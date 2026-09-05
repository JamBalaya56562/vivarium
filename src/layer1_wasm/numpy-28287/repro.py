# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "numpy==2.5.2",
# ]
# ///
"""Vivarium Layer 1 reproduction — numpy/numpy#28287, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real NumPy build:

    mise install                                                  # one-time
    mise exec uv -- uv run src/layer1_wasm/numpy-28287/repro.py

PEP 723 inline metadata pins numpy to **2.5.2**, the latest release:
whether the bug survives there is what decides if it is still open.
The page runs the numpy Pyodide bundles (2.4.6), where it also
reproduces.

Compares three `timedelta64` values — two carrying a unit, one on the
generic unit — and prints each pairwise `<` answer. Exits 0 on
`reproduced` (ordering is non-transitive across the generic unit),
1 on `unreproduced` (ordering is transitive; likely fixed upstream).
"""

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
}

broken = "   <-- transitivity broken" if transitivity_violated else ""

print("Three timedelta64 values, two of them carrying a unit:")
print()
print("x = 1 ms")
print("y = 2 (generic unit)")
print("z = 5 ns")
print()
print("x < y  -> " + str(x_lt_y))
print("y < z  -> " + str(y_lt_z))
print("x < z  -> " + str(x_lt_z) + broken)
print()
if transitivity_violated:
    print("Ordering is not transitive: x < y and y < z, yet x >= z.")
else:
    print("Ordering is transitive on these three values.")
print("numpy " + result["numpy_version"] + " / Python " + result["python_version"])

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
