# jj-vcs/jj#10189 — re-running a rewrite within the same second after jj undo fails with an internal error

Commit timestamps have one-second resolution. After `jj undo`, running the
same rewriting command again within that second re-creates exactly the
commits the undone operation wrote. Those are still in the index, so the
baseline aborts with `Internal error: Unexpected error from backend` caused by
`Newly-created commit <id> already exists`.

## Sources

| Role | Repository | Commit | Followed branch |
| --- | --- | --- | --- |
| baseline | [jj-vcs/jj](https://github.com/jj-vcs/jj) | `b5c61830e73eccb3f7f79661c0915681fdc00dd3` | `main` |
| fix | [Marukome0743/jj](https://github.com/Marukome0743/jj/tree/fix-10189) | `226377683a389c15af492d695a9935223b74a8b3` | `fix-10189` |

The fix is [jj-vcs/jj#10190](https://github.com/jj-vcs/jj/pull/10190). It
lets `CommitBuilder::write()` accept a commit id that already exists when an
ancestor operation recorded the same rewrite with exactly the same
predecessors, and rejects every other collision as before.

`recipe.json` declares both as `guests`. `commit` is what the fixed-guest
builder builds and what `fixed-guest-bump` moves; `accepted` is the build
published as its Release, and only `accepted` runs on the site.

| Role | Accepted Release | ELF SHA256 |
| --- | --- | --- |
| baseline | `guest-jj-a59a45398d836404f8d3bb7f6bf469589a9024ecff94f5bd0e8f83873299515e` | `d7bf88b8fb1829952c8e4a83a1dadee9a93c4f10fefa09622a46c79bac8dc55f` |
| fix | `guest-jj-8b8baadf381637c244d3628fcd4ae6ba587ac1268b6c8ca01f8a5bac238f6ca1` | `fb50f1a7afdb57a1ee9ab73ce9bd24293b1fe35199e3e6c2aecea422a1579ba9` |

Both guests are accepted, and `src/layer1_wasm/formicarium.pin.json` pins the
formicarium package, so the recipe is **active**: it is on the site and in
the regression suite.

## The input

Each terminal starts in an empty `/work/app`. Every command pins
`JJ_TIMESTAMP`, which makes the result independent of how long each command
takes. Both terminals run, side by side:

```sh
JJ_TIMESTAMP=2001-02-03T04:05:06+07:00 jj git init
JJ_TIMESTAMP=2001-02-03T04:05:06+07:00 jj new -m B
JJ_TIMESTAMP=2001-02-03T04:05:06+07:00 jj describe @- -m NEW
JJ_TIMESTAMP=2001-02-03T04:05:06+07:00 jj undo
JJ_TIMESTAMP=2001-02-03T04:05:06+07:00 jj describe @- -m NEW
```

Every command but the last must succeed, and the first `jj describe @- -m
NEW` must print the parent commit it created. When the last command fails
naming that commit as already existing, the run is reproduced; when it
succeeds and prints the same parent commit, it is corrected. The verdict comes
from the baseline alone; the fix pane reports whether the fix is corrected. A
failed command or unexpected output is reported as an error, never as a
verdict.

## Runtime

The guests are static `x86_64-unknown-linux-musl` jj builds run by
[formicarium](https://www.npmjs.com/package/@aletheia-works/formicarium) in a
Worker of this tab. The site build stages the pinned npm package and the
accepted Release builds next to the page after checking every digest, and
each terminal checks the ELF and its build-info against `accepted` again
before running it.

The page needs cross-origin isolation, which `coi-serviceworker.js` from
[`@aletheia-works/coi-serviceworker`](https://github.com/aletheia-works/coi-serviceworker)
provides; `generate-repro-pages` copies it from `docs/node_modules` next to
the page. The service worker always answers with
`Cross-Origin-Embedder-Policy: require-corp`; WebKit does not isolate the
Worker under `credentialless`. A cross-origin request without a
`Cross-Origin-Resource-Policy` header therefore fails on this page.

formicarium's `LICENSE` and `THIRD_PARTY_NOTICES.md` are staged with it in
the page's `_formicarium/<version>/` directory; `assets.json` there lists
every staged file and its SHA256. jj's licence is in its repository at the
commits above, and each guest Release carries it with the third-party notices
of the crates it is built from.
