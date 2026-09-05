import type { PathACapturedRun } from '../_shared/path_a.js';
import {
  loadVivariumRuby,
  type RubyRunner,
  type RunResult,
} from '../_shared/ruby_loader.js';
import { enableRunner } from '../_shared/runner.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const REPRO_CODE = String.raw`
prefix = '\p{In_Arabic}'
suffix = '\p{In_Arabic}'.encode('US-ASCII')

begin
  re = /#{prefix}#{suffix}/
  regexp_raised = nil
rescue => e
  regexp_raised = e.class.name
end

begin
  str = "#{prefix}#{suffix}"
  string_encoding = str.encoding.name
  string_raised = nil
rescue => e
  string_encoding = nil
  string_raised = e.class.name
end

$result = {
  ruby_version: RUBY_VERSION,
  regexp_built: regexp_raised.nil?,
  regexp_raised: regexp_raised,
  string_built: string_raised.nil?,
  string_encoding: string_encoding,
  string_raised: string_raised,
}

regexp_note =
  regexp_raised ? "raised #{regexp_raised}   <-- rejected" : 'built'
string_note =
  string_raised ? "raised #{string_raised}" : "built, encoding #{string_encoding}"

puts 'Interpolating the same two fragments, one UTF-8 and one US-ASCII:'
puts
puts '  Regexp   /#{prefix}#{suffix}/    ' + regexp_note
puts '  String   "#{prefix}#{suffix}"    ' + string_note
puts
if regexp_raised && string_raised.nil?
  puts 'The two forms disagree: Regexp interpolation rejects the mixed'
  puts 'encodings that String interpolation silently upgrades.'
else
  puts 'The two forms agree on how to combine fragments of different encodings.'
end
puts "Ruby #{RUBY_VERSION}"
`.trim();

const RESET_RESULT = '$result = nil';
const READ_RESULT = 'require "json"; JSON.dump($result)';

interface ReproOutput {
  ruby_version: string;
  regexp_built: boolean;
  regexp_raised: string | null;
  string_built: boolean;
  string_encoding: string | null;
  string_raised: string | null;
}

const outputEl = document.getElementById('output');
const metaEl = document.getElementById('meta');
const reproCodeEl = document.getElementById('repro-code');

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    'ruby-21709: missing required DOM elements (#output, #meta, #repro-code).',
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

function evaluate(result: ReproOutput | null): {
  verdict: 'reproduced' | 'unreproduced';
  message: string;
} {
  if (!result) {
    return {
      verdict: 'unreproduced',
      message: 'bug not reproduced — the script left no `$result` hash behind.',
    };
  }
  if (!result.regexp_built && result.string_built) {
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

function readResult(ruby: RubyRunner): ReproOutput | null {
  const probe = ruby.eval(READ_RESULT);
  if (probe.error !== null || probe.value === null) return null;
  try {
    return JSON.parse(probe.value) as ReproOutput | null;
  } catch {
    return null;
  }
}

interface CaptureResult {
  run: PathACapturedRun;
  parsed: ReproOutput | null;
}

function toCapture(run: RunResult, parsed: ReproOutput | null): CaptureResult {
  if (run.error !== null) {
    return {
      run: {
        exitCode: 1,
        verdict: 'unreproduced',
        message: `runtime error: ${run.error}`,
        stdout: [run.stdout, run.error].filter(Boolean).join('\n'),
      },
      parsed: null,
    };
  }
  const ev = evaluate(parsed);
  return {
    run: {
      exitCode: parsed ? 0 : 1,
      verdict: ev.verdict,
      message: ev.message,
      stdout: run.stdout.trimEnd(),
    },
    parsed,
  };
}

function captureRun(ruby: RubyRunner, source: string): CaptureResult {
  ruby.eval(RESET_RESULT);
  const run = ruby.eval(source);
  return toCapture(run, run.error === null ? readResult(ruby) : null);
}

const startedAt = new Date();

try {
  const { ruby, rubyWasmVersion, rubyVersion } = await loadVivariumRuby({
    pendingText: 'Loading Ruby.wasm runtime and stdlib…',
  });

  setVerdict('pending', 'Running reproduction script…');
  const baseline = captureRun(ruby, REPRO_CODE);

  outputEl.textContent = baseline.run.stdout;
  setVerdict(baseline.run.verdict, baseline.run.message);

  const baselineResult = baseline.parsed;
  if (!baselineResult) {
    throw new Error(baseline.run.message);
  }

  metaEl.textContent = `Ruby ${baselineResult.ruby_version} via @ruby/${rubyVersion}-wasm-wasi v${rubyWasmVersion}.`;

  const finishedAt = new Date();
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
      reproduced: baseline.run.verdict === 'reproduced',
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);

  enableRunner({
    slug: 'ruby-21709',
    baselineSource: REPRO_CODE,
    runFix: (source) => Promise.resolve(captureRun(ruby, source).run),
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
