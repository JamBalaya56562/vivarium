# Vivarium Layer 1 reproduction — ruby/ruby#21709, native variant.
#
# Mirrors the script that runs in `repro.ts` (under Ruby.wasm) so a
# contributor can re-verify the bug against a real Ruby interpreter:
#
#   mise install                     # one-time, picks up .mise.toml
#   mise exec ruby -- ruby src/layer1_wasm/ruby-21709/repro.rb
#
# Prints `pass` if the bug REPRODUCES (Regexp interpolation rejects
# the mixed-encoding combine ∧ String interpolation accepts it),
# `fail` otherwise. Exit code: 0 on `pass`, 1 on `fail` so CI can
# shell-script around it without parsing stdout.

require "json"

result = { ruby_version: RUBY_VERSION }

prefix = '\p{In_Arabic}'
suffix = '\p{In_Arabic}'.encode("US-ASCII")

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

reproduced = !result[:regexp_built] && result[:string_built]
result[:reproduced] = reproduced

puts JSON.pretty_generate(result)

if reproduced
  warn "verdict=pass — bug reproduces on this interpreter"
  exit 0
elsif result[:regexp_built] && result[:string_built]
  warn "verdict=fail — Regexp and String interpolation now agree (likely fixed upstream)"
  exit 1
else
  warn "verdict=fail — unexpected outcome (regexp_built=#{result[:regexp_built]}, string_built=#{result[:string_built]})"
  exit 1
end
