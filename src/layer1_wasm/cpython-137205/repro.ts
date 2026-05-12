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
//
// After the baseline run, the recipe enables `enableRunner({...})` so
// visitors can edit the script and re-run via the Run button. The
// captured-run shape uses the same
// `PathACapturedRun` interface Path A uses, so a single `captureRun`
// adapter feeds both the runner and (when applicable) the Path A panel.

import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

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

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'cpython-137205: missing required DOM elements (#output, #meta, #repro-code).',
  );
}

// Build-time inlining (`scripts/highlight-repros.ts`) populates this
// element in `index.html` with the syntax-highlighted source spans,
// so the page paints the code at HTML-parse time. The runtime
// fallback below kicks in only when the placeholder is still empty.
if (!reproCodeEl.firstChild) {
  reproCodeEl.textContent = REPRO_CODE;
  fetch('./repro.highlighted.html')
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (html) reproCodeEl.innerHTML = html;
    })
    .catch(() => {});
}

function evaluate(result: ReproOutput): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (result.fk_disagreement) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — autocommit=False silently drops PRAGMA foreign_keys; the two connections disagree.',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — both connections agree on PRAGMA foreign_keys (likely fixed upstream).',
  };
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const result = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    const ev = evaluate(result);
    return {
      exitCode: 0,
      verdict: ev.verdict,
      message: ev.message,
      stdout: JSON.stringify(result, null, 2),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      verdict: 'unreproduced',
      message: `runtime error: ${message}`,
      stdout: message,
    };
  }
}

const startedAt = new Date();

try {
  // sqlite3 is unvendored from the Python stdlib in the Pyodide
  // distribution and ships as a separately-loadable package; preload
  // it alongside the runtime bootstrap.
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['sqlite3'],
    pendingText: 'Loading Pyodide runtime and sqlite3…',
  });

  setVerdict('pending', 'Running reproduction script…');
  const runtime = pyodide as PyodideRuntime;
  const baseline = await captureRun(runtime, REPRO_CODE);

  let baselineResult: ReproOutput | null = null;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    // baseline failed before producing parseable JSON — surface the raw
    // message in the output panel and stop short of trying to populate
    // the meta line / verdict envelope.
    outputEl.textContent = baseline.stdout;
    setVerdict(baseline.verdict, baseline.message);
    throw new Error(baseline.message);
  }

  metaEl.textContent =
    `Python ${baselineResult.python_version} with stdlib sqlite3 ` +
    `(SQLite ${baselineResult.sqlite_version}) via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'cpython',
      issue: 137205,
      upstream_url: 'https://github.com/python/cpython/issues/137205',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        sqlite: baselineResult.sqlite_version,
      },
    },
    result: {
      off_autocommit_fk: baselineResult.off_autocommit_fk,
      on_autocommit_fk: baselineResult.on_autocommit_fk,
      fk_disagreement: baselineResult.fk_disagreement,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  // The runner mounts itself around the existing #repro-code <pre>, so no
  // additional mount point is required in the recipe HTML.
  enableRunner({
    slug: 'cpython-137205',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
