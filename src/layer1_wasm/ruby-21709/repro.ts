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

import { loadVivariumRuby } from "../_shared/ruby_loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

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

const outputEl = document.getElementById("output");
const metaEl = document.getElementById("meta");
const reproCodeEl = document.getElementById("repro-code");

if (!outputEl || !metaEl || !reproCodeEl) {
  throw new Error(
    "ruby-21709: missing required DOM elements (#output, #meta, #repro-code).",
  );
}

reproCodeEl.textContent = REPRO_CODE;

const startedAt = new Date();

try {
  const { vm, rubyWasmVersion, rubyVersion } = await loadVivariumRuby({
    pendingText: "Loading Ruby.wasm runtime and stdlib…",
  });

  setVerdict("pending", "Running reproduction script…");
  const rb = vm as RubyVM;
  const jsonText = rb.eval(REPRO_CODE).toString();
  const result = JSON.parse(jsonText) as ReproOutput;

  metaEl.textContent =
    `Ruby ${result.ruby_version} via @ruby/${rubyVersion}-wasm-wasi v${rubyWasmVersion}.`;
  outputEl.textContent = JSON.stringify(result, null, 2);

  // Bug reproduces iff Regexp interpolation raises but String
  // interpolation succeeds — the documented inconsistency.
  const reproduced = !result.regexp_built && result.string_built;

  if (reproduced) {
    setVerdict(
      "reproduced",
      "bug reproduced — Regexp interpolation rejects mixed encodings while String interpolation silently upgrades.",
    );
  } else if (result.regexp_built && result.string_built) {
    setVerdict(
      "unreproduced",
      "bug not reproduced — Regexp and String interpolation now agree (likely fixed upstream).",
    );
  } else {
    setVerdict(
      "unreproduced",
      `bug not reproduced — unexpected outcome (regexp_built=${result.regexp_built}, string_built=${result.string_built}).`,
    );
  }

  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: "v1",
    bug: {
      project: "ruby",
      issue: 21709,
      upstream_url: "https://bugs.ruby-lang.org/issues/21709",
    },
    runtime: {
      name: "ruby.wasm",
      version: rubyWasmVersion,
      extras: {
        ruby: result.ruby_version,
        ruby_wasi_package: `@ruby/${rubyVersion}-wasm-wasi`,
      },
    },
    result: {
      regexp_built: result.regexp_built,
      regexp_raised: result.regexp_raised,
      string_built: result.string_built,
      string_encoding: result.string_encoding,
      string_raised: result.string_raised,
      reproduced,
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
