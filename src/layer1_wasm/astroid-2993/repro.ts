// Vivarium Layer 1 reproduction — pylint-dev/astroid#2993.
//
// `astroid.builder.parse(code)` raises an unhandled `MemoryError` (or
// `RecursionError`, depending on the runtime) when fed a fuzzed type
// comment like `a=b # type:i{{{{...{{`. CPython's compiler walks the
// type-comment expression recursively; astroid does not catch the
// runtime error, so it propagates out of `parse` and crashes any
// caller (pylint, IDE plugins, etc.).
//
// The expected fix mirrors astroid's #2762 fix for f-strings (shipped
// in 4.1.2): catch `MemoryError`/`RecursionError` in the type-comment
// parser and treat the comment as opaque.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — `astroid.builder.parse` raised an unhandled
//     `MemoryError` / `RecursionError` (or any non-`AstroidSyntaxError`).
//   - "unreproduced" — `parse` returned cleanly, or raised
//     `AstroidSyntaxError` (which would mean upstream landed a
//     graceful catch).
//
// astroid is **not** in Pyodide's bundled package set, so we install
// it via `micropip` after the Pyodide bootstrap. Its only required
// dep — `typing-extensions` — is already bundled, so the install is
// a single pure-Python wheel from PyPI.

import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

// 270 nested `{` mirrors the fuzz from the upstream issue. The exact
// threshold at which CPython's compiler runs out of stack is
// implementation-dependent; 270 reproduces reliably on the Python
// 3.13 build Pyodide v0.29.3 ships. Hardcoded inside the template
// literal so the build-time syntax highlighter (which does not
// expand ${…} substitutions) renders the source visitors run.
const REPRO_CODE = `
import sys
import astroid

NESTED = 270
code = "a=b # type:i" + "{" * NESTED

result = {
    "astroid_version": astroid.__version__,
    "python_version": sys.version.split()[0],
    "nested_braces": NESTED,
    "exception_type": None,
    "exception_message": None,
    "crashed": False,
}

try:
    astroid.builder.parse(code)
except astroid.exceptions.AstroidSyntaxError as e:
    result["exception_type"] = "AstroidSyntaxError"
    result["exception_message"] = str(e)[:200]
except (MemoryError, RecursionError) as e:
    result["exception_type"] = type(e).__name__
    result["exception_message"] = str(e)[:200]
    result["crashed"] = True
except Exception as e:
    result["exception_type"] = type(e).__name__
    result["exception_message"] = str(e)[:200]
    result["crashed"] = True

result
`.trim();

interface ReproOutput {
  astroid_version: string;
  python_version: string;
  nested_braces: number;
  exception_type: string | null;
  exception_message: string | null;
  crashed: boolean;
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
    'astroid-2993: missing required DOM elements (#output, #meta, #repro-code).',
  );
}

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
  if (result.crashed) {
    return {
      verdict: 'reproduced',
      message: `bug reproduced — astroid.builder.parse raised ${result.exception_type} on a fuzzed type comment.`,
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — astroid handled the fuzzed type comment without an unhandled runtime error.',
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
  // micropip is bundled with Pyodide; astroid + typing-extensions are
  // pulled from PyPI on first run. typing-extensions is already in the
  // Pyodide package set so micropip resolves it without a download.
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });

  setVerdict('pending', 'Installing astroid from PyPI…');
  const runtime = pyodide as PyodideRuntime;
  await runtime.runPythonAsync(`
import micropip
await micropip.install("astroid==4.1.2")
`);

  setVerdict('pending', 'Running reproduction script…');
  const baseline = await captureRun(runtime, REPRO_CODE);

  let baselineResult: ReproOutput | null = null;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    outputEl.textContent = baseline.stdout;
    setVerdict(baseline.verdict, baseline.message);
    throw new Error(baseline.message);
  }

  metaEl.textContent =
    `astroid ${baselineResult.astroid_version} on Python ${baselineResult.python_version} ` +
    `via Pyodide v${version}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'astroid',
      issue: 2993,
      upstream_url: 'https://github.com/pylint-dev/astroid/issues/2993',
    },
    runtime: {
      name: 'pyodide',
      version,
      extras: {
        python: baselineResult.python_version,
        astroid: baselineResult.astroid_version,
      },
    },
    result: {
      nested_braces: baselineResult.nested_braces,
      exception_type: baselineResult.exception_type,
      crashed: baselineResult.crashed,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'astroid-2993',
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
