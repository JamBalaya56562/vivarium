# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "lark==1.3.1",
# ]
# ///
"""Vivarium Layer 1 reproduction — lark-parser/lark#1585, native variant.

The browser page runs the same grammar inside a Web Worker so the
infinite loop does not freeze the tab; the native variant uses a
subprocess + ``subprocess.TimeoutExpired`` so the parent process can
walk away from the hung child without depending on ``signal.alarm``
(Windows-friendly).

Bug: ``Lark('start.1: "a" | start start*', parser='lalr').parse('aa')``
hangs indefinitely under the LALR and CYK back-ends. Without the
``.1`` priority lark raises ``GrammarError`` instead, and the Earley
back-end terminates normally — both are documented in the upstream
issue thread.

Verdict semantics:
- ``reproduced``   — the child process did not return within the
  budget (default 8 s).
- ``unreproduced`` — the child returned (bug fixed) or raised
  before the budget elapsed (bug behaviour changed; the specific
  hang reported upstream did not trigger).
"""

import json
import subprocess
import sys
import time

TIMEOUT_S = 8.0

CHILD_SCRIPT = r"""
import sys
import lark
from lark import Lark

print(lark.__version__, sys.version.split()[0], flush=True, file=sys.stderr)
Lark('start.1: "a" | start start*', parser='lalr').parse('aa')
"""


def main() -> int:
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            [sys.executable, "-c", CHILD_SCRIPT],
            timeout=TIMEOUT_S,
            capture_output=True,
            text=True,
            check=False,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        child_meta = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else ""
        lark_version, _, python_version = child_meta.partition(" ")
        result = {
            "lark_version": lark_version or "unknown",
            "python_version": python_version or sys.version.split()[0],
            "outcome": "returned" if completed.returncode == 0 else "raised",
            "exit_code": completed.returncode,
            "stderr_tail": (completed.stderr or "").splitlines()[-5:],
            "elapsed_ms": elapsed_ms,
            "timeout_ms": TIMEOUT_S * 1000,
            "reproduced": False,
        }
        print(json.dumps(result, indent=2))
        if completed.returncode == 0:
            msg = "verdict=unreproduced — Lark(...).parse('aa') returned cleanly within the budget."
        else:
            msg = (
                "verdict=unreproduced — child raised before timeout "
                f"(exit {completed.returncode}); the infinite loop reported "
                "upstream did not trigger."
            )
        print(msg, file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        result = {
            "lark_version": "1.3.1",
            "python_version": sys.version.split()[0],
            "outcome": "timeout",
            "exit_code": None,
            "stderr_tail": (exc.stderr.decode(errors="replace") if exc.stderr else "").splitlines()[
                -5:
            ],
            "elapsed_ms": elapsed_ms,
            "timeout_ms": TIMEOUT_S * 1000,
            "reproduced": True,
        }
        print(json.dumps(result, indent=2))
        print(
            f"verdict=reproduced — Lark(...).parse('aa') hung past {TIMEOUT_S:.0f}s; "
            "the LALR back-end exhibits the infinite loop reported upstream.",
            file=sys.stderr,
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
