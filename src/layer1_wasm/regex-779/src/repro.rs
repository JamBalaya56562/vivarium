// Vivarium Layer 1 reproduction — rust-lang/regex#779.
//
// `(re)+` should be equivalent to `(re)(re)*`. With the `(?m)(^|a)+`
// pattern (multiline mode, alternating between line-anchor and 'a')
// against the haystack "a\naaa\n", the two equivalent forms produce
// different match-iteration outputs on regex 1.8.4:
//
//   (?m)(^|a)+         => (0, 0) (2, 2) (3, 5) (6, 6)
//   (?m)(^|a)(^|a)*    => (0, 1) (2, 5) (6, 6)
//
// The disagreement is a violation of regex algebra and reproduced in
// the rust-lang/regex crate, RE2, and Go's regexp (PCRE2 got it
// right). Fixed upstream in regex 1.9, alongside the new NFA compiler.
//
// This module is compiled TWICE, once per crate, and the two builds
// differ only in the `regex` version their `Cargo.toml` pins:
//
//   ../Cargo.toml     regex =1.8.4   -> repro.wasm      (baseline)
//   ../../fix/Cargo.toml  regex =1.13.1 -> repro-fix.wasm   (fix candidate)
//
// The page runs both and shows the outputs side by side. Sharing one
// copy of the logic is what makes that a fair comparison rather than
// two scripts that merely look alike, so `run` takes the version
// string as a parameter instead of embedding a constant.
//
// Each build doubles as a native CLI variant
// (`cargo run --release --manifest-path <that Cargo.toml>`).
// Verdict semantics match the rest of the gallery (Contract v1
// Revision 3 / ADR-0029):
//   - exit 0 + JSON `"reproduced": true`  → page reports "reproduced"
//   - exit 1 + JSON `"reproduced": false` → page reports "unreproduced"
//
// Only the baseline build drives the page verdict. The fix-candidate
// build is expected to exit 1 — that is the desired outcome, not a
// failure.

use regex::Regex;
use serde_json::json;

fn matches(re: &Regex, haystack: &str) -> Vec<(usize, usize)> {
    re.find_iter(haystack)
        .map(|m| (m.start(), m.end()))
        .collect()
}

pub fn run(regex_crate_version: &str) -> ! {
    let haystack = "a\naaa\n";
    let pattern_plus = "(?m)(^|a)+";
    let pattern_expanded = "(?m)(^|a)(^|a)*";

    let re_plus = Regex::new(pattern_plus).expect("compile (re)+ pattern");
    let re_expanded = Regex::new(pattern_expanded).expect("compile (re)(re)* pattern");

    let matches_plus = matches(&re_plus, haystack);
    let matches_expanded = matches(&re_expanded, haystack);
    let reproduced = matches_plus != matches_expanded;

    let result = json!({
        "regex_crate_version": regex_crate_version,
        "haystack": haystack,
        "pattern_plus": pattern_plus,
        "pattern_expanded": pattern_expanded,
        "matches_plus": matches_plus,
        "matches_expanded": matches_expanded,
        "reproduced": reproduced,
    });

    println!(
        "{}",
        serde_json::to_string(&result).expect("serialise result")
    );

    if reproduced {
        eprintln!("verdict=reproduced — `(re)+` and `(re)(re)*` disagree on this haystack");
        std::process::exit(0);
    } else {
        eprintln!("verdict=unreproduced — `(re)+` and `(re)(re)*` agree (likely fixed upstream)");
        std::process::exit(1);
    }
}
