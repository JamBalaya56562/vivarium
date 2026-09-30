// Vivarium Layer 1 reproduction — aubepkg/aube#1645.
//
// pnpm-format lockfiles (`aube-lock.yaml`, `pnpm-lock.yaml`) record no
// version for `file:` directory and `link:` dependencies, only where
// they live. aube's lockfile reader fills in a `0.0.0` placeholder, so
// every command that reads the lockfile instead of resolving —
// `aube install --frozen-lockfile`, `--prod`, `aube list` — reports
// those packages as `0.0.0`, while a fresh resolve reads the real
// version from their own `package.json`.
//
// This module is compiled TWICE, once per crate, and the two builds
// differ only in which aube commit their `Cargo.toml` points at:
//
//   ../Cargo.toml      aube v2.6.1 (latest release)  -> repro.wasm
//   ../fix/Cargo.toml  aubepkg/aube#1645 head        -> repro-fix.wasm
//
// The page runs both and shows the outputs side by side. The aube
// label arrives as a parameter so neither build embeds the other's.
//
// Both builds compile aube from source. `../prepare.sh` downloads the
// two commits and applies `../wasm-compat.patch`, which keeps aube-util's
// network and async-I/O stack off wasm32 — the lockfile reader under
// test is untouched. Each build doubles as a native CLI variant
// (`cargo run --release --manifest-path <that Cargo.toml>`).
//
// stdout is the table a reader sees on the page. stderr carries the
// machine-readable line the page parses for its Contract v1 envelope,
// followed by the verdict line:
//   - exit 0 + `"reproduced": true`  → page reports "reproduced"
//   - exit 1 + `"reproduced": false` → page reports "unreproduced"

use std::fs;
use std::path::{Path, PathBuf};

use aube_lockfile::LocalSource;
use aube_manifest::PackageJson;
use serde_json::json;

const APP_PACKAGE_JSON: &str = r#"{
  "name": "app",
  "version": "1.0.0",
  "dependencies": {
    "filedep": "file:./filedep",
    "linked": "link:../outside/linked"
  }
}
"#;

// What `aube install` writes for the manifest above. The two local
// packages carry a path, and no version.
const AUBE_LOCK_YAML: &str = "lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      filedep:
        specifier: file:./filedep
        version: file:./filedep
      linked:
        specifier: link:../outside/linked
        version: link:../outside/linked

packages:

  filedep@file:./filedep:
    resolution: {directory: ./filedep, type: directory}

snapshots:

  filedep@file:./filedep: {}
";

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("fixture path has a parent"))
        .expect("create fixture directory");
    fs::write(path, contents).expect("write fixture file");
}

// The page preopens an empty in-memory `/tmp` for the wasm build; WASI
// has no temp-dir convention of its own to ask.
fn scratch_root() -> PathBuf {
    if cfg!(target_os = "wasi") {
        PathBuf::from("/tmp")
    } else {
        std::env::temp_dir()
    }
}

fn project() -> PathBuf {
    let root = scratch_root().join("vivarium-aube-1645");
    let _ = fs::remove_dir_all(&root);
    let app = root.join("app");
    write(&app.join("package.json"), APP_PACKAGE_JSON);
    write(&app.join("aube-lock.yaml"), AUBE_LOCK_YAML);
    write(
        &app.join("filedep/package.json"),
        r#"{ "name": "filedep", "version": "1.0.0" }"#,
    );
    write(
        &root.join("outside/linked/package.json"),
        r#"{ "name": "linked", "version": "2.0.0" }"#,
    );
    app
}

pub fn run(aube_label: &str) -> ! {
    let app = project();
    let manifest =
        PackageJson::from_path(&app.join("package.json")).expect("read app/package.json");
    let graph = aube_lockfile::parse_lockfile(&app, &manifest).expect("parse app/aube-lock.yaml");

    let mut rows = Vec::new();
    for pkg in graph.packages.values() {
        let (spec, dir) = match &pkg.local_source {
            Some(LocalSource::Directory(dir)) => ("file:", dir),
            Some(LocalSource::Link(dir)) => ("link:", dir),
            _ => continue,
        };
        let own = PackageJson::from_path(&app.join(dir).join("package.json"))
            .expect("read the local package's package.json")
            .version
            .unwrap_or_default();
        rows.push(json!({
            "name": pkg.name,
            "specifier": format!("{spec}{}", dir.display()),
            "lockfile_version": pkg.version,
            "package_json_version": own,
        }));
    }
    let reproduced = rows
        .iter()
        .any(|row| row["lockfile_version"] != row["package_json_version"]);

    println!("aube {aube_label}: parse_lockfile(\"app/\")");
    println!();
    println!("package   specifier                 from lockfile   its package.json");
    for row in &rows {
        let differs = row["lockfile_version"] != row["package_json_version"];
        println!(
            "{:<10}{:<26}{:<16}{}{}",
            row["name"].as_str().unwrap_or_default(),
            row["specifier"].as_str().unwrap_or_default(),
            row["lockfile_version"].as_str().unwrap_or_default(),
            row["package_json_version"].as_str().unwrap_or_default(),
            if differs { "   <- wrong" } else { "" },
        );
    }
    println!();
    if reproduced {
        println!("Installs from the lockfile and `aube list` report these packages as 0.0.0.");
    } else {
        println!("The lockfile graph carries each package's real version.");
    }

    let result = json!({
        "aube": aube_label,
        "packages": rows,
        "reproduced": reproduced,
    });
    eprintln!(
        "{}",
        serde_json::to_string(&result).expect("serialise result")
    );

    if reproduced {
        eprintln!("verdict=reproduced — file: and link: deps read from the lockfile are 0.0.0");
        std::process::exit(0);
    } else {
        eprintln!(
            "verdict=unreproduced — the lockfile graph carries the real versions (likely fixed upstream)"
        );
        std::process::exit(1);
    }
}
