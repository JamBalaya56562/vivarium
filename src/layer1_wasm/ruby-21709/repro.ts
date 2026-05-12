// Vivarium Layer 1 reproduction — ruby/ruby#21709.
//
// Regexp interpolation rejects mixed encodings while String
// interpolation silently upgrades to UTF-8:
//   prefix = '\p{In_Arabic}'
//   suffix = '\p{In_Arabic}'.encode('US-ASCII')
//   /#{prefix}#{suffix}/  # => RegexpError ("encoding mismatch")
//   "#{prefix}#{suffix}"  # => "\p{In_Arabic}\p{In_Arabic}"
// The two interpolation forms should agree on how to combine
// fragments of different encodings — they don't.
//
// Verdict semantics (per ADR-0008 / contract v1):
//   - "reproduced" — the bug REPRODUCES (Regexp raises, String succeeds).
//   - "unreproduced" — the bug does NOT reproduce (the runtime ships a fix,
//     or the runtime errored before producing a result).

import type { PathACapturedRun } from '../_shared/path_a.js';
import { loadVivariumRuby } from '../_shared/ruby_loader.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const REPRO_CODE = String.raw`
require "json"

result = { ruby_version: RUBY_VERSION }

prefix = '\p{In_Arabic}'
suffix = '\p{In_Arabic}'.encode('US-ASCII')

begin
  re = /#{prefix}#{suffix}/
  result[:regexp_built] = true
  result[:regexp_raised] = nil
rescue => e
  result[:regexp_built] = false
  result[:regexp_raised] = e.class.name
end

begin
  s = "#{prefix}#{suffix}"
  result[:string_built] = true
  result[:string_encoding] = s.encoding.name
  result[:string_raised] = nil
rescue => e
  result[:string_built] = false
  result[:string_encoding] = nil
  result[:string_raised] = e.class.name
end

JSON.dump(result)
`.trim();

interface ReproOutput {
  ruby_version: string;
  regexp_built: boolean;
  regexp_raised: string | null;
  string_built: boolean;
  string_encoding: string | null;
  string_raised: string | null;
}

interface RubyVM {
  eval(code: string): { toString(): string };
}

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'ruby-21709: missing required DOM elements (#output, #meta, #repro-code).',
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
  const reproduced = !result.regexp_built && result.string_built;
  if (reproduced) {
    return {
      verdict: 'reproduced',
      message:
        'bug reproduced — Regexp interpolation rejects mixed encodings while String interpolation silently upgrades.',
    };
  }
  if (result.regexp_built && result.string_built) {
    return {
      verdict: 'unreproduced',
      message:
        'bug not reproduced — Regexp and String interpolation now agree (likely fixed upstream).',
    };
  }
  return {
    verdict: 'unreproduced',
    message: `bug not reproduced — unexpected outcome (regexp_built=${result.regexp_built}, string_built=${result.string_built}).`,
  };
}

async function captureRun(
  rb: RubyVM,
  source: string,
): Promise<PathACapturedRun> {
  try {
    const jsonText = rb.eval(source).toString();
    const result = JSON.parse(jsonText) as ReproOutput;
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
  const { vm, rubyWasmVersion, rubyVersion } = await loadVivariumRuby({
    pendingText: 'Loading Ruby.wasm runtime and stdlib…',
  });

  setVerdict('pending', 'Running reproduction script…');
  const rb = vm as RubyVM;
  const baseline = await captureRun(rb, REPRO_CODE);

  let baselineResult: ReproOutput | null = null;
  try {
    baselineResult = JSON.parse(baseline.stdout) as ReproOutput;
  } catch {
    outputEl.textContent = baseline.stdout;
    setVerdict(baseline.verdict, baseline.message);
    throw new Error(baseline.message);
  }

  metaEl.textContent = `Ruby ${baselineResult.ruby_version} via @ruby/${rubyVersion}-wasm-wasi v${rubyWasmVersion}.`;
  outputEl.textContent = baseline.stdout;
  setVerdict(baseline.verdict, baseline.message);

  const finishedAt = new Date();
  const reproduced = baseline.verdict === 'reproduced';
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: {
      project: 'ruby',
      issue: 21709,
      upstream_url: 'https://bugs.ruby-lang.org/issues/21709',
    },
    runtime: {
      name: 'ruby.wasm',
      version: rubyWasmVersion,
      extras: {
        ruby: baselineResult.ruby_version,
        ruby_wasi_package: `@ruby/${rubyVersion}-wasm-wasi`,
      },
    },
    result: {
      regexp_built: baselineResult.regexp_built,
      regexp_raised: baselineResult.regexp_raised,
      string_built: baselineResult.string_built,
      string_encoding: baselineResult.string_encoding,
      string_raised: baselineResult.string_raised,
      reproduced,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  // Wire the editable script + Run button.
  enableRunner({
    slug: 'ruby-21709',
    baselineSource: REPRO_CODE,
    runFix: (source) => captureRun(rb, source),
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
