// Vivarium Layer 1 reproduction — python/cpython#137205.
//
// `PRAGMA foreign_keys = ON` is silently a no-op when issued on a
// `sqlite3.Connection` opened with `autocommit=False`:
//   off = sqlite3.connect(":memory:", autocommit=False)
//   off.execute("PRAGMA foreign_keys = ON")  # <-- silently dropped
//   on  = sqlite3.connect(":memory:", autocommit=True)
//   on.execute("PRAGMA foreign_keys = ON")   # <-- takes effect
//   off.execute("PRAGMA foreign_keys").fetchone()[0]  # => 0
//   on.execute("PRAGMA foreign_keys").fetchone()[0]   # => 1
// The two connections should agree on whether FK enforcement is on.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — the bug REPRODUCES (the two connections disagree).
//   - "unreproduced" — the bug does NOT reproduce (the runtime ships a fix,
//     or the runtime errored before producing a result).

import { loadVivariumPyodide } from "../_shared/loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

const REPRO_CODE = `
import sys
import sqlite3

off = sqlite3.connect(":memory:", autocommit=False)
off.execute("PRAGMA foreign_keys = ON")
off.commit()

on = sqlite3.connect(":memory:", autocommit=True)
on.execute("PRAGMA foreign_keys = ON")

off_value = off.execute("PRAGMA foreign_keys").fetchone()[0]
on_value = on.execute("PRAGMA foreign_keys").fetchone()[0]

{
    "python_version": sys.version.split()[0],
    "sqlite_version": sqlite3.sqlite_version,
    "off_autocommit_fk": int(off_value),
    "on_autocommit_fk": int(on_value),
    "fk_disagreement": off_value != on_value,
}
`.trim();

interface ReproOutput {
  python_version: string;
  sqlite_version: string;
  off_autocommit_fk: number;
  on_autocommit_fk: number;
  fk_disagreement: boolean;
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<{
    toJs(opts: { dict_converter: typeof Object.fromEntries }): ReproOutput;
    destroy?(): void;
  }>;
}

const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "cpython-137205: missing required DOM elements (#output, #meta, #repro-code).",
  );
}

reproCodeEl.textContent = REPRO_CODE;
fetch("./repro.highlighted.html")
  .then((r) => (r.ok ? r.text() : null))
  .then((html) => {
    if (html) reproCodeEl.innerHTML = html;
  })
  .catch(() => {});

const startedAt = new Date();

try {
  // sqlite3 is unvendored from the Python stdlib in the Pyodide
  // distribution and ships as a separately-loadable package; preload
  // it alongside the runtime bootstrap.
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ["sqlite3"],
    pendingText: "Loading Pyodide runtime and sqlite3…",
  });

  setVerdict("pending", "Running reproduction script…");
  const runtime = pyodide as PyodideRuntime;
  const proxy = await runtime.runPythonAsync(REPRO_CODE);
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy?.();

  metaEl.textContent =
    `Python ${result.python_version} with stdlib sqlite3 ` +
    `(SQLite ${result.sqlite_version}) via Pyodide v${version}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  if (result.fk_disagreement) {
    setVerdict(
      "reproduced",
      "bug reproduced — autocommit=False silently drops PRAGMA foreign_keys; the two connections disagree.",
    );
  } else {
    setVerdict(
      "unreproduced",
      "bug not reproduced — both connections agree on PRAGMA foreign_keys (likely fixed upstream).",
    );
  }

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "cpython",
      issue: 137205,
      upstream_url: "https://github.com/python/cpython/issues/137205",
    },
    runtime: {
      name: "pyodide",
      version,
      extras: {
        python: result.python_version,
        sqlite: result.sqlite_version,
      },
    },
    result: {
      off_autocommit_fk: result.off_autocommit_fk,
      on_autocommit_fk: result.on_autocommit_fk,
      fk_disagreement: result.fk_disagreement,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
