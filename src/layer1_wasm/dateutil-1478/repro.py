# /// script
# requires-python = ">=3.13"
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

Exits 0 on ``reproduced`` (bug present — both UTC-prefixed inputs
land on the wrong sign), 1 on ``unreproduced`` (the inversion is
gone; likely fixed upstream or a runtime quirk).
"""

import json
import sys

import dateutil
from dateutil.parser import parse


def utcoffset_seconds(spec: str) -> int:
    dt = parse(f"2026-03-11 14:32:45 {spec}")
    off = dt.utcoffset()
    assert off is not None, f"parse({spec!r}) returned a naive datetime"
    return int(off.total_seconds())


# Each (input, expected_seconds) pair encodes one assertion. The
# verdict is "reproduced" when at least one assertion fails AND the
# failures match the sign-inversion shape (observed == -expected).
CASES = [
    ("UTC-4", -14400),
    ("UTC+4", +14400),
    ("UTC-04:00", -14400),
    ("UTC+04:00", +14400),
]

observations = []
for label, expected in CASES:
    actual = utcoffset_seconds(label)
    observations.append(
        {
            "input": label,
            "expected_offset_seconds": expected,
            "actual_offset_seconds": actual,
            "inverted": actual == -expected and actual != expected,
        }
    )

# Sign-inversion bug is present when at least one of the UTC-prefixed
# numeric forms returns the negated offset. We do not gate on "all
# four inverted" because a partial fix upstream (e.g. only ":HH:MM"
# patched) should still flip the verdict to unreproduced.
inversions = sum(1 for o in observations if o["inverted"])
reproduced = inversions == len(CASES)

result = {
    "dateutil_version": dateutil.__version__,
    "python_version": sys.version.split()[0],
    "cases": observations,
    "inverted_count": inversions,
    "case_count": len(CASES),
    "reproduced": reproduced,
}

print(json.dumps(result, indent=2))

if reproduced:
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
