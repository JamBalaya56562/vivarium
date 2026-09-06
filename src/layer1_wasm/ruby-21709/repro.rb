# Vivarium Layer 1 reproduction — ruby/ruby#21709, native variant.
#
# Mirrors the script that runs in `repro.ts` (under Ruby.wasm) so a
# contributor can re-verify the bug against a real Ruby interpreter:
#
#   mise install                     # one-time, picks up mise.toml
#   mise exec ruby -- ruby src/layer1_wasm/ruby-21709/repro.rb
#
# Interpolates the same two fragments — one UTF-8, one US-ASCII — into
# a Regexp and into a String, and prints what each one did. Exits 0 on
# `reproduced` (Regexp interpolation rejects the combine ∧ String
# interpolation accepts it), 1 on `unreproduced`, so CI can shell-script
# around it without parsing stdout.

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

if $result[:regexp_built] == false && $result[:string_built]
  warn 'verdict=reproduced — bug reproduces on this interpreter'
  exit 0
elsif $result[:regexp_built] && $result[:string_built]
  warn 'verdict=unreproduced — Regexp and String interpolation now agree (likely fixed upstream)'
  exit 1
else
  warn "verdict=unreproduced — unexpected outcome (regexp_built=#{$result[:regexp_built]}, string_built=#{$result[:string_built]})"
  exit 1
end
