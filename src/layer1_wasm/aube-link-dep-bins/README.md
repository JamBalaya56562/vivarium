# aubepkg/aube — a dependency's .bin skips the bins of its link: dependencies

aube gives each dependency its own `node_modules/.bin`, which goes on the
`PATH` of that dependency's lifecycle scripts. It holds the bins of the
registry and `file:` dependencies the package declares, but the baseline
skips the ones it declares with `link:`, so a build script that calls such a
bin fails with "command not found".

No upstream issue or pull request has a number yet, so the recipe is named
after the behaviour.

## Sources

| Role | Repository | Commit | Followed branch |
| --- | --- | --- | --- |
| baseline | [aubepkg/aube](https://github.com/aubepkg/aube) | `dc0f6f80811270b3e3b2dffdb58c5e335487fd36` | `main` |
| fix | [JamBalaya56562/aube](https://github.com/JamBalaya56562/aube/tree/link-transitive-link-dep-bins) | `0a6137570b30445bd5ac76b2a6d7701ea15b4785` | `link-transitive-link-dep-bins` |

The fix is one commit on top of the baseline. It changes `link_dep_bins` in
`crates/aube/src/commands/install/bin_linking.rs` to link a `link:` child's
bins from its target's `package.json`, and adds the bats test "a
dependency's build can run the bin of a link: dep it declares" to
`test/local_deps.bats`.

`recipe.json` declares both as `guests`. `commit` is what the fixed-guest
builder builds and what `fixed-guest-bump` moves; `accepted` is the build
published as its Release, and only `accepted` runs on the site.

| Role | Accepted Release | ELF SHA256 |
| --- | --- | --- |
| baseline | `guest-aube-4f4080eb645a16d8e355c9ce5004b2f4cad734f560f33aee3f4a1015bc1e2e17` | `bce70243db2349e5469a96899606056cd2c80a26f4fcad90e41e7164c674c8ae` |
| fix | `guest-aube-8c3f68102545dfa1f4550c56befc72d7bc58a4f9852400f0c8cc2958cf915093` | `df94311b449811f742dcfe3c59bc0d79ea8173b162577ea71f94f5c4fda6806b` |

Both guests are accepted, and `src/layer1_wasm/formicarium.pin.json` pins the
formicarium package, so the recipe is **active**: it is on the site and in
the regression suite.

## The input

Each terminal starts from the recipe's `fixture/` in `/work/app`:

- `package.json`: `app`, depending on `builder` through
  `file:./vendor/builder`
- `vendor/builder/package.json`: `builder`, depending on `linked-tool`
  through `link:../linked-tool`
- `vendor/linked-tool/package.json`: `linked-tool`, declaring the bin
  `linked-tool` as `cli.js`

Both terminals run the same commands:

```sh
cat vendor/builder/package.json
aube install
ls node_modules/.aube/builder@file+f207b01d788bfbae/node_modules
```

formicarium has no shell, no Node.js and no network, so no lifecycle script
can run. The fixture declares none, and the page reads the directory those
scripts would get on their `PATH` instead. The listing must show `builder/`
and `linked-tool -> /work/app/vendor/linked-tool`. When it also shows
`.bin/`, the terminal runs one more command:

```sh
ls node_modules/.aube/builder@file+f207b01d788bfbae/node_modules/.bin
```

`linked-tool` in `.bin` is corrected; no `.bin/`, or a `.bin` without it, is
reproduced. The fix's `.bin/linked-tool` is aube's `#!/bin/sh` bin shim. The verdict comes from the baseline alone; the
fix pane reports whether the fix is corrected. A failed check, command or
unexpected listing is reported as an error, never as a verdict.

## Runtime

The guests are static `x86_64-unknown-linux-musl` aube builds run by
[formicarium](https://www.npmjs.com/package/@aletheia-works/formicarium) in a
Worker of this tab. The site build stages the pinned npm package and the
accepted Release builds next to the page after checking every digest, and
each terminal checks the ELF and its build-info against `accepted` again
before running it.

The page needs cross-origin isolation, which `coi-serviceworker.js` (0.1.7)
provides. The page sets `coepCredentialless` to `false`, so the service worker
answers with `Cross-Origin-Embedder-Policy: require-corp`; WebKit does not
isolate the Worker under `credentialless`. A cross-origin request without a
`Cross-Origin-Resource-Policy` header therefore fails on this page.

formicarium's `LICENSE` and `THIRD_PARTY_NOTICES.md` are staged with it in
the page's `_formicarium/<version>/` directory; `assets.json` there lists
every staged file and its SHA256. aube's licence is in its repository at the
commits above, and each guest Release carries it with the third-party notices
of the crates it is built from.
