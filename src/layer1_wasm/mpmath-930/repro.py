# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "mpmath==1.4.1",
# ]
# ///
"""Vivarium Layer 1 reproduction — mpmath/mpmath#930, native variant.

Mirrors the script that runs in ``repro.ts`` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real mpmath install:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/mpmath-930/repro.py

PEP 723 inline metadata pins mpmath to **1.4.1** — the latest PyPI
release as of 2026-05-19. The bug remains unfixed there.

``mpmath.jtheta(2, mpc("99", "1"), mpc("0.99", "0"))`` at the default
precision (``mp.dps=15``) returns roughly ``-1.73e9 + 7.19e8j``. The
correct value (verified at ``mp.dps=200``, agreeing with Mathematica)
is roughly ``-1.50e-57 + 1.13e-58j`` — the buggy answer is off by
about 66 orders of magnitude. Verdict is "reproduced" when the
absolute value of the result exceeds ``1e6`` (the buggy magnitude is
~1.87e9; the correct magnitude is ~1.5e-57).

Prints ``reproduced=true`` to JSON output. Exit code: 0 on
``reproduced``, 1 on ``unreproduced`` so CI can shell-script around
it without parsing stdout.
"""

import json
import sys

import mpmath
from mpmath import mpc

# Default precision (mp.dps = 15) — the regime where the bug appears.
result_value = mpmath.jtheta(2, mpc("99", "1"), mpc("0.99", "0"))
real = float(mpmath.re(result_value))
imag = float(mpmath.im(result_value))
magnitude = float(abs(result_value))

# Bug: magnitude lands near 1.87e9 instead of ~1.5e-57. Use 1e6 as the
# threshold — anything above is the buggy regime; anything below would
# only happen if upstream fixed the precision loss at default dps.
reproduced = magnitude > 1e6

result = {
    "mpmath_version": mpmath.__version__,
    "python_version": sys.version.split()[0],
    "mp_dps": mpmath.mp.dps,
    "result_real": real,
    "result_imag": imag,
    "result_abs": magnitude,
    "expected_abs_at_dps200": 1.5e-57,
    "reproduced": reproduced,
}

print(json.dumps(result, indent=2))

if reproduced:
    print(
        "verdict=reproduced — jtheta(2, 99+1j, 0.99) returned magnitude "
        f"{magnitude:.3e} at dps=15, expected ~1.5e-57.",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — jtheta returned a near-zero magnitude at "
        "default dps (likely fixed upstream).",
        file=sys.stderr,
    )
    sys.exit(1)
