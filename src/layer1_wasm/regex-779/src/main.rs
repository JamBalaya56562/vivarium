// Vivarium Layer 1 reproduction — rust-lang/regex#779.
//
// `(re)+` should be equivalent to `(re)(re)*`. With the `(?m)(^|a)+`
// pattern (multiline mode, alternating between line-anchor and 'a')
// against the haystack "a\naaa\n", the two equivalent forms produce
// different match-iteration outputs:
//
//   (?m)(^|a)+         => (0, 0) (2, 2) (3, 5) (6, 6)
//   (?m)(^|a)(^|a)*    => (0, 1) (2, 5) (6, 6)
//
// The disagreement is a violation of regex algebra and reproduces in
// the rust-lang/regex crate, RE2, and Go's regexp (PCRE2 gets it
// right). Open upstream at the time of writing.
//
// Same script doubles as the in-browser reproduction (compiled to
// wasm32-wasip1 and run via `@bjorn3/browser_wasi_shim`) and as the
// native CLI variant (`cargo run --release` from this directory).
// Verdict semantics match the rest of the gallery (Contract v1
// Revision 3 / ADR-0029):
//   - exit 0 + JSON `"reproduced": true`  → page reports "reproduced"
//   - exit 1 + JSON `"reproduced": false` → page reports "unreproduced"

use regex::Regex;
use serde_json::json;

// Hand-pinned to the version in `Cargo.toml`. Bumping the dep is a
// deliberate edit, so the duplication is acceptable in exchange for
// a single embedded version string that survives WASM linking.
const REGEX_CRATE_VERSION: &str = "1.8.4";

fn matches(re: &Regex, haystack: &str) -> Vec<(usize, usize)> {
    re.find_iter(haystack).map(|m| (m.start(), m.end())).collect()
}

fn main() {
    let haystack = "a\naaa\n";
    let pattern_plus = "(?m)(^|a)+";
    let pattern_expanded = "(?m)(^|a)(^|a)*";

    let re_plus = Regex::new(pattern_plus).expect("compile (re)+ pattern");
    let re_expanded = Regex::new(pattern_expanded).expect("compile (re)(re)* pattern");

    let matches_plus = matches(&re_plus, haystack);
    let matches_expanded = matches(&re_expanded, haystack);
    let reproduced = matches_plus != matches_expanded;

    let result = json!({
        "regex_crate_version": REGEX_CRATE_VERSION,
        "haystack": haystack,
        "pattern_plus": pattern_plus,
        "pattern_expanded": pattern_expanded,
        "matches_plus": matches_plus,
        "matches_expanded": matches_expanded,
        "reproduced": reproduced,
    });

    println!("{}", serde_json::to_string(&result).expect("serialise result"));

    if reproduced {
        eprintln!(
            "verdict=reproduced — `(re)+` and `(re)(re)*` disagree on this haystack"
        );
        std::process::exit(0);
    } else {
        eprintln!(
            "verdict=unreproduced — `(re)+` and `(re)(re)*` agree (likely fixed upstream)"
        );
        std::process::exit(1);
    }
}
