// Vivarium Layer 1 reproduction — pylint-dev/astroid#2993.
//
// `astroid.builder.parse(code)` raises an unhandled `MemoryError`
// when fed a fuzzed type comment like `a = b # type:i{{{{...{{`.
// CPython's compiler walks the type-comment expression recursively;
// astroid 4.1.2 does not cut off pathological nesting before parsing,
// so the runtime error propagates out of `parse` and crashes any caller
// (pylint, IDE plugins, etc.).
//
// The expected fix detects pathological type-comment nesting up front,
// skips that invalid type comment without parsing it, and still parses
// deeply nested but valid type comments. The fix candidate this page
// renders side-by-side is upstream PR #3049
// (https://github.com/pylint-dev/astroid/pull/3049) — built into a
// pure-Python wheel under `./wheels/` and installed into the same
// Pyodide tab so visitors can compare the before/after verdict in one
// page load.
//
// Verdict semantics (per ADR-0008 / contract v1) — applied to each
// variant card individually; the top-level `#verdict` pill mirrors the
// **baseline** variant so the existing Contract v1 single-verdict
// surface (`__VIVARIUM_VERDICT__`, `data-verdict`) keeps its prior
// meaning and downstream consumers do not need to branch.
//   - "reproduced" — a pathological type comment crashed
//     `astroid.builder.parse`.
//   - "unreproduced" — both pathological comments were skipped before
//     parsing and the valid deep-nesting control still parsed.

import { loadVivariumPyodide } from '../_shared/loader.js';
import type { PathACapturedRun } from '../_shared/path_a.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

// 200 nested `{` matches the minimized upstream regression test in
// PR #3049. Hardcoded inside the template literal so the build-time
// syntax highlighter (which does not expand ${…} substitutions)
// renders the source visitors run.
const REPRO_CODE = `
import sys
import astroid

NESTED = 200
VALID_DEPTH = 20


def case_result(name, code, inspect):
    out = {
        "name": name,
        "exception_type": None,
        "exception_message": None,
        "crashed": False,
    }
    try:
        module = astroid.builder.parse(code)
        out.update(inspect(module))
    except astroid.exceptions.AstroidSyntaxError as e:
        out["exception_type"] = "AstroidSyntaxError"
        out["exception_message"] = str(e)[:200]
    except (MemoryError, RecursionError) as e:
        out["exception_type"] = type(e).__name__
        out["exception_message"] = str(e)[:200]
        out["crashed"] = True
    except Exception as e:
        out["exception_type"] = type(e).__name__
        out["exception_message"] = str(e)[:200]
        out["crashed"] = True
    return out


def inspect_assignment(module):
    return {"type_annotation_is_none": module.body[0].type_annotation is None}


def inspect_function(module):
    node = module.body[0]
    return {
        "type_comment_returns_is_none": node.type_comment_returns is None,
        "type_comment_args_is_none": node.type_comment_args is None,
    }


def inspect_valid_assignment(module):
    return {"type_annotation_is_present": module.body[0].type_annotation is not None}


assignment_code = "a = b # type:i" + "{" * NESTED
function_code = "def func():\\n    # type: i" + "{" * NESTED + "\\n    pass\\n"
valid_inner = "List[" * VALID_DEPTH + "int" + "]" * VALID_DEPTH
valid_code = f"a = b # type: {valid_inner}"

assignment = case_result("pathological_assignment", assignment_code, inspect_assignment)
function = case_result("pathological_function", function_code, inspect_function)
valid_control = case_result("valid_deep_nesting", valid_code, inspect_valid_assignment)

pathological_cases = [assignment, function]
crashed = any(bool(case["crashed"]) for case in pathological_cases)
skipped_pathological = (
    assignment.get("type_annotation_is_none") is True
    and function.get("type_comment_returns_is_none") is True
    and function.get("type_comment_args_is_none") is True
)
valid_control_parsed = valid_control.get("type_annotation_is_present") is True

result = {
    "astroid_version": astroid.__version__,
    "python_version": sys.version.split()[0],
    "nested_braces": NESTED,
    "valid_depth": VALID_DEPTH,
    "exception_type": next(
        (case["exception_type"] for case in pathological_cases if case["crashed"]),
        None,
    ),
    "crashed": crashed,
    "skipped_pathological": skipped_pathological,
    "valid_control_parsed": valid_control_parsed,
    "cases": {
        "assignment": assignment,
        "function": function,
        "valid_control": valid_control,
    },
}

result
`.trim();

interface ReproCaseOutput {
  name: string;
  exception_type: string | null;
  exception_message: string | null;
  crashed: boolean;
  type_annotation_is_none?: boolean;
  type_comment_returns_is_none?: boolean;
  type_comment_args_is_none?: boolean;
  type_annotation_is_present?: boolean;
}

interface ReproOutput {
  astroid_version: string;
  python_version: string;
  nested_braces: number;
  valid_depth: number;
  exception_type: string | null;
  crashed: boolean;
  skipped_pathological: boolean;
  valid_control_parsed: boolean;
  cases: {
    assignment: ReproCaseOutput;
    function: ReproCaseOutput;
    valid_control: ReproCaseOutput;
  };
}

interface PyodideRuntime {
  runPythonAsync(code: string): Promise<{
    toJs(opts: { dict_converter: typeof Object.fromEntries }): ReproOutput;
    destroy?(): void;
  }>;
}

interface WheelManifest {
  schema_version: number;
  package: string;
  filename: string;
  version: string;
  source: {
    type: string;
    url: string;
    ref: string;
    commit?: string;
    spec?: string;
  };
  upstream_pr?: string;
  fetched_at?: string;
}

const outputBaselineEl = document.getElementById('output');
const outputFixEl = document.getElementById('output-fix');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputBaselineEl || !outputFixEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'astroid-2993: missing required DOM elements (#output, #output-fix, #meta, #repro-code).',
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
      message: `bug reproduced — astroid.builder.parse raised ${result.exception_type} on a pathological type comment.`,
    };
  }
  if (result.skipped_pathological && result.valid_control_parsed) {
    return {
      verdict: 'unreproduced',
      message:
        'bug not reproduced — astroid skipped pathological type comments before parsing and kept valid deep nesting intact.',
    };
  }
  return {
    verdict: 'unreproduced',
    message:
      'bug not reproduced — astroid no longer crashes, but the pathological-skip or valid-control assertions did not all pass.',
  };
}

function normalizeCase(result: ReproCaseOutput): ReproCaseOutput {
  return {
    ...result,
    exception_type: result.exception_type ?? null,
    exception_message: result.exception_message ?? null,
  };
}

// Re-shape the dict that came back through `pyodide.toJs(...)` so the
// stringified form is symmetric across the baseline and fix-candidate
// variants. Pyodide maps Python `None` to JS `undefined`, and
// `JSON.stringify` strips `undefined`-valued keys. Normalising here
// keeps both panels comparable at a glance.
function normalize(result: ReproOutput): ReproOutput {
  return {
    astroid_version: result.astroid_version,
    python_version: result.python_version,
    nested_braces: result.nested_braces,
    valid_depth: result.valid_depth,
    exception_type: result.exception_type ?? null,
    crashed: result.crashed,
    skipped_pathological: result.skipped_pathological,
    valid_control_parsed: result.valid_control_parsed,
    cases: {
      assignment: normalizeCase(result.cases.assignment),
      function: normalizeCase(result.cases.function),
      valid_control: normalizeCase(result.cases.valid_control),
    },
  };
}

async function captureRun(
  runtime: PyodideRuntime,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const proxy = await runtime.runPythonAsync(source);
    const raw = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    const result = normalize(raw);
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

// Drop the in-memory astroid module tree so the next `import astroid`
// resolves the freshly-installed wheel rather than the previously-loaded
// version. Pyodide caches imports in `sys.modules`; `del` is the only
// reliable way to force a re-resolution after `micropip.uninstall`.
async function reinstallAstroid(
  runtime: PyodideRuntime,
  installSpec: string,
): Promise<void> {
  await runtime.runPythonAsync(`
import micropip, sys
try:
    await micropip.uninstall("astroid")
except Exception:
    pass
for _name in [n for n in list(sys.modules) if n == "astroid" or n.startswith("astroid.")]:
    del sys.modules[_name]
await micropip.install(${JSON.stringify(installSpec)})
`);
}

const startedAt = new Date();

let baselineCapture: PathACapturedRun | null = null;
let baselineParsed: ReproOutput | null = null;
let fixCapture: PathACapturedRun | null = null;
let fixParsed: ReproOutput | null = null;
let manifest: WheelManifest | null = null;

try {
  // micropip is bundled with Pyodide; astroid + typing-extensions are
  // pulled from PyPI on first run for the baseline variant.
  // typing-extensions is already in the Pyodide package set so micropip
  // resolves it without a download.
  const { pyodide, version } = await loadVivariumPyodide({
    packages: ['micropip'],
    pendingText: 'Loading Pyodide runtime and micropip…',
  });
  const runtime = pyodide as PyodideRuntime;

  // Baseline variant: PyPI astroid==4.1.2.
  setVerdict('pending', 'Installing astroid==4.1.2 from PyPI…');
  await runtime.runPythonAsync(`
import micropip
await micropip.install("astroid==4.1.2")
`);

  setVerdict('pending', 'Running reproduction script (baseline)…');
  baselineCapture = await captureRun(runtime, REPRO_CODE);
  try {
    baselineParsed = JSON.parse(baselineCapture.stdout) as ReproOutput;
  } catch {
    baselineParsed = null;
  }
  outputBaselineEl.textContent = baselineCapture.stdout;

  // Build the Contract v1 envelope as a closure that reflects whatever
  // variant data is currently captured. Called once after baseline (so
  // `__VIVARIUM_RESULT__` is populated by the time the top-level
  // `#verdict` pill flips to "reproduced" — Playwright reads the
  // envelope at that moment and would otherwise see `undefined`), and
  // again after the fix-candidate run completes so the envelope picks
  // up the second variant.
  const buildEnvelope = (): VivariumResultV1 | null => {
    if (!baselineParsed || !baselineCapture) return null;
    const finishedAt = new Date();
    return {
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
          python: baselineParsed.python_version,
          astroid: baselineParsed.astroid_version,
          ...(fixParsed
            ? { astroid_fix_candidate: fixParsed.astroid_version }
            : {}),
        },
      },
      result: {
        nested_braces: baselineParsed.nested_braces,
        valid_depth: baselineParsed.valid_depth,
        exception_type: baselineParsed.exception_type,
        crashed: baselineParsed.crashed,
        skipped_pathological: baselineParsed.skipped_pathological,
        valid_control_parsed: baselineParsed.valid_control_parsed,
        cases: baselineParsed.cases,
        baseline: {
          spec: 'astroid==4.1.2',
          verdict: baselineCapture.verdict,
          astroid_version: baselineParsed.astroid_version,
          exception_type: baselineParsed.exception_type,
          crashed: baselineParsed.crashed,
          skipped_pathological: baselineParsed.skipped_pathological,
          valid_control_parsed: baselineParsed.valid_control_parsed,
          cases: baselineParsed.cases,
        },
        fix_candidate:
          fixParsed && fixCapture && manifest
            ? {
                spec:
                  manifest.source.spec ??
                  `astroid @ git+${manifest.source.url}@${manifest.source.ref}`,
                verdict: fixCapture.verdict,
                astroid_version: fixParsed.astroid_version,
                exception_type: fixParsed.exception_type,
                crashed: fixParsed.crashed,
                skipped_pathological: fixParsed.skipped_pathological,
                valid_control_parsed: fixParsed.valid_control_parsed,
                cases: fixParsed.cases,
                upstream_pr: manifest.upstream_pr ?? null,
              }
            : null,
      },
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      },
    };
  };

  // Publish the baseline-only envelope BEFORE flipping the verdict
  // pill — Playwright's regression suite reads
  // `__VIVARIUM_RESULT__` the moment `data-verdict` leaves `pending`.
  const initialEnvelope = buildEnvelope();
  if (initialEnvelope) setResult(initialEnvelope);

  // Top-level verdict pill mirrors baseline — preserves the
  // single-verdict Contract v1 surface for downstream consumers.
  setVerdict(baselineCapture.verdict, baselineCapture.message);

  metaEl.textContent =
    `Baseline astroid ${baselineParsed?.astroid_version ?? '?'} on Python ` +
    `${baselineParsed?.python_version ?? '?'} via Pyodide v${version}.`;

  // Fix-candidate variant: committed wheel.
  outputFixEl.textContent = 'Fetching wheel manifest…';
  let manifestRes: Response | null = null;
  try {
    manifestRes = await fetch('./wheels/manifest.json', { cache: 'no-store' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputFixEl.textContent = `Could not fetch wheel manifest: ${message}`;
  }

  if (manifestRes && manifestRes.ok) {
    manifest = (await manifestRes.json()) as WheelManifest;
    const wheelUrl = new URL(
      `./wheels/${manifest.filename}`,
      window.location.href,
    ).toString();
    outputFixEl.textContent =
      `Installing ${manifest.filename} (${manifest.version})…\n` +
      `from ${manifest.source.url}@${manifest.source.ref}`;
    try {
      await reinstallAstroid(runtime, wheelUrl);
      fixCapture = await captureRun(runtime, REPRO_CODE);
      try {
        fixParsed = JSON.parse(fixCapture.stdout) as ReproOutput;
      } catch {
        fixParsed = null;
      }
      outputFixEl.textContent = fixCapture.stdout;
    } catch (err) {
      const errAny = err as { stack?: string; message?: string } | null;
      const message =
        (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
      outputFixEl.textContent = `Fix-candidate install/run failed: ${message}`;
    }
  } else if (manifestRes && !manifestRes.ok) {
    outputFixEl.textContent = `Wheel manifest unavailable (HTTP ${manifestRes.status}).`;
  }

  // Restore baseline astroid so the visitor-facing runner (Edit + Run)
  // operates against the buggy build — the runner's documented mental
  // model is "test your script change against the same broken
  // interpreter the recipe loaded". Without this, runner.runFix would
  // execute against the fix-candidate astroid, which is semantically
  // surprising for visitors paste-editing the script.
  try {
    await reinstallAstroid(runtime, 'astroid==4.1.2');
  } catch {
    // Non-fatal — the runner will still execute against whatever
    // astroid is currently loaded; just log once for diagnostics.
    console.warn(
      'astroid-2993: failed to restore baseline for the runner; runner.runFix will run against the fix-candidate.',
    );
  }

  // ---- Contract v1 envelope (final) ---------------------------------
  // Re-publish the envelope now that the fix-candidate variant has
  // also captured (or definitively failed). `result` keeps the
  // historical baseline-only fields so consumers reading
  // `__VIVARIUM_RESULT__.result.crashed` continue to work, and the
  // additive `baseline` / `fix_candidate` sub-objects describe each
  // variant separately. Additive change — no `contract` version bump.
  const finalEnvelope = buildEnvelope();
  if (finalEnvelope) setResult(finalEnvelope);

  enableRunner({
    slug: 'astroid-2993',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(runtime, source),
  });
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputBaselineEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  if (globalThis.__VIVARIUM_VERDICT__ !== 'unreproduced') {
    setVerdict(
      'unreproduced',
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
