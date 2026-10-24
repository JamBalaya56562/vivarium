# biomejs/biome — Prettier migration drops bracketSpacing from a *.js override

A Prettier configuration that sets `bracketSpacing: false` only for `*.js`
files is migrated by `biome migrate prettier --write` into a Biome
`overrides` entry for `*.js`. The baseline drops the option: the migrated
override no longer turns bracket spacing off, so Biome formats those files
with spaces inside braces.

Upstream issue: [biomejs/biome#12643](https://github.com/biomejs/biome/issues/12643).
Fix: [biomejs/biome#12649](https://github.com/biomejs/biome/pull/12649),
from the fix branch below. The recipe keeps its behaviour-named slug
because that pull request links to this page.

## Sources

| Role | Repository | Commit | Followed branch |
| --- | --- | --- | --- |
| baseline | [biomejs/biome](https://github.com/biomejs/biome) | `ef61338b24b7125fbc3cb3d4792ec90fa005a86e` | `main` |
| fix | [JamBalaya56562/biome](https://github.com/JamBalaya56562/biome/tree/fix/migrate-prettier-override-bracket-spacing) | `a5bd0ce883a22980be20dfc87ba62006a43c3de8` | `fix/migrate-prettier-override-bracket-spacing` |

`recipe.json` declares both as `guests`. `commit` is what the fixed-guest
builder builds and what `fixed-guest-bump` moves; `accepted` is the build a
maintainer accepted from its Release, and only `accepted` runs on the site.

| Role | Accepted Release | ELF SHA256 |
| --- | --- | --- |
| baseline | `guest-biome-086287f859011917208c205bd00239373027ed52fffdc7d07f9526129268322c` | `97c88a1cb957ecb557ddf9eb9299c8a515d4b7f2c0dd50c60ed91e19ffdeb7a6` |
| fix | `guest-biome-dabb518b1731e82752bf6f26471df6ba9ad41947b7a31352cdc45638e746c24d` | `364ef17da79a6eadb508e93cceb3c1c33d7619e80a94bb9846db2cd57712ff84` |

Both guests are accepted, and `src/layer1_wasm/formicarium.pin.json` pins
formicarium 0.4.0, so the recipe is **active**: it is on the site and in the
regression suite.

## The input

Each terminal starts from the recipe's `fixture/` in `/work/app`:

- `.prettierrc`: `{"overrides":[{"files":["*.js"],"options":{"bracketSpacing":false}}]}`
- `biome.json`: `{}`

Both terminals run the same commands:

```sh
cat .prettierrc
cat biome.json
biome migrate prettier --write
cat biome.json
```

The page reads the migrated `biome.json`, finds the override whose
`includes` is `["*.js"]`, and reads `formatter.bracketSpacing` or
`javascript.formatter.bracketSpacing` there. `false` in either place is
corrected; neither is reproduced. The verdict comes from the baseline alone;
the fix pane reports whether the fix is corrected. A failed check, command or
parse is reported as an error, never as a verdict.

## Runtime

The guests are static `x86_64-unknown-linux-musl` Biome builds run by
[formicarium](https://www.npmjs.com/package/@aletheia-works/formicarium) in a
Worker of this tab. The site build stages the pinned npm package and the
accepted Release builds next to the page after checking every digest, and
each terminal checks the ELF and its build-info against `accepted` again
before running it.

The page needs cross-origin isolation, which `coi-serviceworker.js` (0.1.7)
provides. The page sets `coepCredentialless` to `false`, so the service worker
answers with `Cross-Origin-Embedder-Policy: require-corp`; WebKit does not
isolate the Worker under `credentialless`. A cross-origin request without a
`Cross-Origin-Resource-Policy` header therefore fails on this page; everything
it loads is same-origin.

formicarium's `LICENSE` and `THIRD_PARTY_NOTICES.md` are staged with it in
the page's `_formicarium/<version>/` directory; `assets.json` there lists
every staged file and its SHA256. Biome's licence is in its repository at the
commits above.
