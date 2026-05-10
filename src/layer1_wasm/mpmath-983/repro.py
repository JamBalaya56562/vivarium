# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "mpmath==1.4.1",
# ]
# ///
"""Vivarium Layer 1 reproduction — mpmath/mpmath#983, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real mpmath build:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/mpmath-983/repro.py

PEP 723 inline metadata pins **mpmath 1.4.1** — the latest release
at authoring time (2026-03-15). `uv run` reads the metadata and
creates an ephemeral venv on first invocation; subsequent runs hit
uv's cache.

The 4x4 system below is the minimal example from the upstream issue.
Wolfram|Alpha and `mp.lu_solve` agree it is solvable (condition
number ≈695, well-conditioned), but `mp.qr_solve` raises
``ValueError: matrix is numerically singular`` because the
Householder QR path's `if not abs(s) > ctx.eps:` guard
(`mpmath/matrices/linalg.py:333`) trips on a sub-eps intermediate
sum that the LU path never sees. Working around with `mp.dps = 10`
(lower precision than the default 15) makes the guard pass.

Exits 0 on `pass` (bug REPRODUCED — qr_solve raised while lu_solve
succeeded), 1 on `fail` (the asymmetry collapsed, likely fixed
upstream).
"""

import json
import sys

import mpmath
from mpmath import mp


def build_system():
    A = mp.matrix(
        [
            [mp.one, -mp.pi / 20, (-mp.pi / 20) ** 2, (-mp.pi / 20) ** 3],
            [mp.one, mp.zero, mp.zero, mp.zero],
            [mp.one, mp.pi / 20, (mp.pi / 20) ** 2, (mp.pi / 20) ** 3],
            [mp.one, mp.pi / 10, (mp.pi / 10) ** 2, (mp.pi / 10) ** 3],
        ]
    )
    b = mp.matrix(
        [
            [mp.sin(-mp.pi / 20)],
            [mp.zero],
            [mp.sin(mp.pi / 20)],
            [mp.sin(mp.pi / 20)],
        ]
    )
    return A, b


A, b = build_system()

result = {
    "mpmath_version": mpmath.__version__,
    "python_version": sys.version.split()[0],
    "mp_dps": mp.dps,
    "qr_solve_raised": False,
    "qr_solve_error": None,
    "lu_solve_succeeded": False,
    "lu_solve_solution": None,
    "asymmetry": False,
}

# qr_solve — expected to raise on the numerically-singular guard.
try:
    mp.qr_solve(A, b)
except ValueError as e:
    result["qr_solve_raised"] = True
    result["qr_solve_error"] = str(e)[:200]

# lu_solve — sanity check that the system *is* solvable. If lu_solve
# also fails the matrix really is singular and qr_solve was right; the
# bug is the asymmetry between the two solvers.
try:
    x_lu = mp.lu_solve(A, b)
    result["lu_solve_succeeded"] = True
    # mp.matrix repr is multi-line; flatten to a list of strings so the
    # JSON output stays readable.
    result["lu_solve_solution"] = [mp.nstr(x_lu[i, 0], 6) for i in range(4)]
except Exception as e:
    result["lu_solve_succeeded"] = False
    result["lu_solve_solution"] = f"lu_solve also raised: {type(e).__name__}: {str(e)[:120]}"

result["asymmetry"] = result["qr_solve_raised"] and result["lu_solve_succeeded"]

print(json.dumps(result, indent=2))

if result["asymmetry"]:
    print(
        "verdict=reproduced — qr_solve raised on a system lu_solve handles fine",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — qr_solve and lu_solve no longer disagree (likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
