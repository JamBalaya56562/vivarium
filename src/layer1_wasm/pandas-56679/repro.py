# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "pandas==2.3.3",
# ]
# ///
"""Vivarium Layer 1 reproduction — pandas-dev/pandas#56679, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real pandas build:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/pandas-56679/repro.py

PEP 723 inline metadata pins pandas to **2.3.3** — the exact version
Pyodide v0.29.3 bundles — so the page and this CLI exercise the same
code path. `uv run` reads the metadata and creates an ephemeral venv
on first invocation; subsequent runs hit uv's cache.

Prints `pass` if the bug REPRODUCES (Series and DataFrame disagree on
empty-input dtype), `fail` otherwise. Exit code: 0 on `pass`, 1 on
`fail` so CI can shell-script around it without parsing stdout.
"""

import json
import sys

import pandas as pd

series_dtype = str(pd.Series([]).dtype)
df_dtype = str(pd.DataFrame({"a": []})["a"].dtype)
mismatch = series_dtype != df_dtype

result = {
    "pandas_version": pd.__version__,
    "python_version": sys.version.split()[0],
    "series_dtype": series_dtype,
    "df_dtype": df_dtype,
    "mismatch": mismatch,
    "reproduced": mismatch,
}

print(json.dumps(result, indent=2))

if mismatch:
    print(
        "verdict=pass — Series and DataFrame disagree on empty-input dtype",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=fail — Series and DataFrame agree on empty-input dtype "
        "(likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
