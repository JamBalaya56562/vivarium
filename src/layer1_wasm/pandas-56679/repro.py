# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "pandas==3.0.5",
# ]
# ///
"""Vivarium Layer 1 reproduction — pandas-dev/pandas#56679, native variant.

Mirrors the script that runs in `repro.ts` (under Pyodide) so a
contributor can re-verify the bug against a real CPython interpreter
+ a real pandas build:

    mise install                                                    # one-time
    mise exec uv -- uv run src/layer1_wasm/pandas-56679/repro.py

PEP 723 inline metadata pins pandas to **3.0.5**, the latest release:
whether the bug survives there is what decides if it is still open.
The page runs the pandas Pyodide bundles (3.0.2), where it also
reproduces. `uv run` reads the metadata and creates an ephemeral venv
on first invocation; subsequent runs hit uv's cache.

Builds an empty Series and an empty single-column DataFrame from the
same empty input and prints the dtype each one reports. Exits 0 on
`reproduced` (the two disagree), 1 on `unreproduced` (they agree;
likely fixed upstream).
"""

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
}

print("Two empty containers built from the same empty input:")
print()
print("pd.Series([]).dtype".ljust(36) + "-> " + series_dtype)
print('pd.DataFrame({"a": []})["a"].dtype'.ljust(36) + "-> " + df_dtype)
print()
if mismatch:
    print("The two disagree: the same empty input yields different dtypes.")
else:
    print("The two agree: both empty containers report the same dtype.")
print("pandas " + result["pandas_version"] + " / Python " + result["python_version"])

if mismatch:
    print(
        "verdict=reproduced — Series and DataFrame disagree on empty-input dtype",
        file=sys.stderr,
    )
    sys.exit(0)
else:
    print(
        "verdict=unreproduced — Series and DataFrame agree on empty-input dtype "
        "(likely fixed upstream)",
        file=sys.stderr,
    )
    sys.exit(1)
