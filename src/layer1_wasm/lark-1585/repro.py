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


def as_text(stream) -> str:
    # TimeoutExpired.stderr is str on Windows and bytes on POSIX, even under text=True.
    if isinstance(stream, (bytes, bytearray)):
        return stream.decode(errors="replace")
    return stream or ""


def format_elapsed(ms: float) -> str:
    return f"{ms / 1000:.1f} s" if ms >= 1000 else f"{ms:.0f} ms"


def report(
    headline: str,
    elapsed: str,
    note: str,
    explanation: str,
    lark_version: str,
    python_version: str,
) -> str:
    return "\n".join(
        [
            headline,
            "",
            f"  budget     {TIMEOUT_S:.1f} s",
            f"  elapsed    {elapsed}{note}",
            "",
            explanation,
            f"lark {lark_version} / Python {python_version}",
        ]
    )


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
        returned = completed.returncode == 0
        print(
            report(
                "parse('aa') returned."
                if returned
                else f"parse('aa') raised (child exited {completed.returncode}).",
                format_elapsed(elapsed_ms),
                "",
                "The parse completed, so the infinite loop did not trigger."
                if returned
                else "The parse ended early, so the infinite loop did not trigger.",
                lark_version or "unknown",
                python_version or sys.version.split()[0],
            )
        )
        if not returned:
            for line in (completed.stderr or "").splitlines()[-5:]:
                print(f"  {line}")
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
        # The child flushes its version banner to stderr before it hangs.
        stderr_str = as_text(exc.stderr)
        child_meta = stderr_str.strip().splitlines()[-1] if stderr_str.strip() else ""
        lark_version, _, python_version = child_meta.partition(" ")
        print(
            report(
                "parse('aa') did not return.",
                format_elapsed(elapsed_ms),
                "   <-- terminated, still running",
                "The LALR back-end is in an infinite loop on this grammar.",
                lark_version or "unknown",
                python_version or sys.version.split()[0],
            )
        )
        print(
            f"verdict=reproduced — Lark(...).parse('aa') hung past {TIMEOUT_S:.0f}s; "
            "the LALR back-end exhibits the infinite loop reported upstream.",
            file=sys.stderr,
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
