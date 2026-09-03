// Vivarium Layer 1 reproduction — rust-lang/regex#779, fix-candidate build.
//
// Compiles the baseline crate's reproduction source verbatim against a
// `regex` release that carries the fix, so the page can show the same
// script producing the right answer next to the wrong one. `#[path]`
// pulls in the module rather than copying it — a divergent copy would
// quietly turn the side-by-side comparison into a lie.

#[path = "../../src/repro.rs"]
mod repro;

// Hand-pinned to the `regex` version in this crate's `Cargo.toml`; see
// the note in `../../src/main.rs` for why the literal is duplicated.
fn main() -> ! {
    repro::run("1.13.1")
}
