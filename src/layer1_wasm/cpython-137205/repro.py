# /// script
# requires-python = ">=3.13"
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

Prints `pass` if the bug REPRODUCES (the two connections disagree
on PRAGMA foreign_keys), `fail` otherwise. Exit code: 0 on `pass`,
1 on `fail`.
"""

import json
import sqlite3
import sys

off = sqlite3.connect(":memory:", autocommit=False)
off.execute("PRAGMA foreign_keys = ON")
off.commit()

on = sqlite3.connect(":memory:", autocommit=True)
on.execute("PRAGMA foreign_keys = ON")

off_value = int(off.execute("PRAGMA foreign_keys").fetchone()[0])
on_value = int(on.execute("PRAGMA foreign_keys").fetchone()[0])
fk_disagreement = off_value != on_value

result = {
    "python_version": sys.version.split()[0],
    "sqlite_version": sqlite3.sqlite_version,
    "off_autocommit_fk": off_value,
    "on_autocommit_fk": on_value,
    "fk_disagreement": fk_disagreement,
    "reproduced": fk_disagreement,
}

print(json.dumps(result, indent=2))

if fk_disagreement:
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
