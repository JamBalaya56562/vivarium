#[path = "../../src/repro.rs"]
mod repro;

// Must match the aube commit ../../prepare.sh fetches for this crate.
fn main() -> ! {
    repro::run("#1645 (e10ac8a4)")
}
