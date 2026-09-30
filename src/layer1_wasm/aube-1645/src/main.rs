mod repro;

// Must match the aube commit ../prepare.sh fetches for this crate.
fn main() -> ! {
    repro::run("v2.6.1")
}
