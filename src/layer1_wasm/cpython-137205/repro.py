# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Vivarium Layer 1 reproduction — python/cpython#137205, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ the host's bundled `sqlite3` extension:

    mise install                                                       # one-time
    mise exec uv -- uv run src/layer1_wasm/cpython-137205/repro.py

`sqlite3` is part of the standard library, so PEP 723's
`dependencies = []` is sufficient — no third-party packages needed.
The bug is in the CPython binding layer, not in libsqlite3 itself,
so the result depends only on the Python interpreter version and not
on the SQLite version baked into it. The Pyodide page exercises the
same Python 3.13 binding through the `sqlite3` Pyodide package; this
CLI exercises the same binding through whatever CPython 3.13 build
mise installs.

Sets `PRAGMA foreign_keys = ON` on two connections that differ only
in their `autocommit` setting, reads the pragma back on each, and
prints the two answers side by side. Exits 0 on `reproduced` (the
two connections disagree), 1 on `unreproduced` (they agree; likely
fixed upstream).
"""

import sqlite3
import sys

DROPPED = "   <-- setting dropped"

off = sqlite3.connect(":memory:", autocommit=False)
off.execute("PRAGMA foreign_keys = ON")
off.commit()

on = sqlite3.connect(":memory:", autocommit=True)
on.execute("PRAGMA foreign_keys = ON")

off_value = int(off.execute("PRAGMA foreign_keys").fetchone()[0])
on_value = int(on.execute("PRAGMA foreign_keys").fetchone()[0])
disagreement = off_value != on_value

result = {
    "python_version": sys.version.split()[0],
    "sqlite_version": sqlite3.sqlite_version,
    "off_autocommit_fk": off_value,
    "on_autocommit_fk": on_value,
    "fk_disagreement": disagreement,
}

off_note = DROPPED if off_value == 0 else ""
on_note = DROPPED if on_value == 0 else ""

print("Set PRAGMA foreign_keys = ON on two connections, then read it back:")
print()
print("autocommit".ljust(14) + "foreign_keys".rjust(14))
print("False".ljust(14) + str(off_value).rjust(14) + off_note)
print("True".ljust(14) + str(on_value).rjust(14) + on_note)
print()
if disagreement:
    print("The two connections disagree: autocommit=False dropped the PRAGMA.")
else:
    print("Both connections agree: the PRAGMA survived on both.")
print("Python " + result["python_version"] + " / SQLite " + result["sqlite_version"])

if disagreement:
    print(
        "verdict=reproduced — autocommit=False silently drops PRAGMA foreign_keys",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — both connections agree on PRAGMA foreign_keys "
        "(likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
