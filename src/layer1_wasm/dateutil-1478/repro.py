# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "python-dateutil==2.9.0.post0",
# ]
# ///
"""Vivarium Layer 1 reproduction — dateutil/dateutil#1478, native variant.

Mirrors the script that runs in ``repro.ts`` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real python-dateutil install:

    mise install                                                       # one-time
    mise exec uv -- uv run src/layer1_wasm/dateutil-1478/repro.py

PEP 723 inline metadata pins python-dateutil to **2.9.0.post0** —
the version reported as exhibiting the bug in the upstream issue
thread (and the latest release at authoring time).

The bug: ``dateutil.parser.parse`` inverts the sign of a numeric
UTC offset whenever the offset is preceded by the literal ``UTC``
prefix.

    parse('2026-03-11 14:32:45 UTC-4').isoformat()
    # -> '2026-03-11T14:32:45+04:00'   (expected: -04:00)

    parse('2026-03-11 14:32:45 UTC+4').isoformat()
    # -> '2026-03-11T14:32:45-04:00'   (expected: +04:00)

Bare ISO 8601 forms (``+04:00`` / ``-04:00`` without the ``UTC``
prefix) parse correctly, so the inversion is isolated to the
``UTC`` + signed-offset code path.

Prints one row per input — expected offset beside the offset
``parse`` actually returned — and marks every row whose sign came
back flipped. Exits 0 on ``reproduced`` (all four rows flipped),
1 on ``unreproduced`` (at least one parsed correctly; likely fixed
upstream or a runtime quirk).
"""

import sys

import dateutil
from dateutil.parser import parse

STAMP = "2026-03-11 14:32:45"
CASES = [("UTC-4", -4), ("UTC+4", +4), ("UTC-04:00", -4), ("UTC+04:00", +4)]


def offset(seconds):
    sign = "-" if seconds < 0 else "+"
    return f"{sign}{abs(seconds) // 3600:02d}:{abs(seconds) % 3600 // 60:02d}"


results = []
for spec, expected_hours in CASES:
    expected = expected_hours * 3600
    actual = int(parse(f"{STAMP} {spec}").utcoffset().total_seconds())
    results.append(
        {
            "input": spec,
            "expected_offset_seconds": expected,
            "actual_offset_seconds": actual,
            "inverted": actual == -expected and actual != expected,
        }
    )

print(f"parse('{STAMP} <input>').utcoffset()")
print()
print(f"{'input':<12}{'expected':>10}{'actual':>10}")
for row in results:
    flag = "   <-- sign flipped" if row["inverted"] else ""
    print(
        f"{row['input']:<12}"
        f"{offset(row['expected_offset_seconds']):>10}"
        f"{offset(row['actual_offset_seconds']):>10}{flag}"
    )
print()
flipped = sum(row["inverted"] for row in results)
print(f"{flipped} of {len(results)} UTC-prefixed offsets came back negated.")
print(f"python-dateutil {dateutil.__version__} / Python {sys.version.split()[0]}")

if flipped == len(results):
    print(
        "verdict=reproduced — every UTC±N input parsed to its negated offset",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — at least one UTC±N input parsed with the "
        "correct sign (likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
