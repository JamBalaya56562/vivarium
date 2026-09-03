// Vivarium Layer 1 reproduction — rust-lang/regex#779, baseline build.
//
// The reproduction itself lives in `repro.rs`, shared verbatim with the
// fix-candidate crate under `../fix/`. The only difference between the
// two builds is the `regex` version each `Cargo.toml` pins, so keeping
// one copy of the logic is what makes the page's side-by-side output a
// fair comparison rather than two scripts that merely look alike.

mod repro;

// Hand-pinned to the `regex` version in this crate's `Cargo.toml`. The
// literal has to survive WASM linking to reach the page's JSON, and
// there is no build-time facility to read it back out of Cargo, so the
// duplication is deliberate — bumping the dependency is an edit in two
// places, on purpose.
fn main() -> ! {
    repro::run("1.8.4")
}
