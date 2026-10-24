# biomejs/biome — Prettier migration leaves the top-level bracketSpacing on

A Prettier configuration that sets `bracketSpacing: false` at its top level
is migrated by `biome migrate prettier --write`. The baseline copies the
option into `javascript.formatter` only and writes the default `true` into
the top-level `formatter.bracketSpacing`, so JSON and every other language
that reads the top-level setting keep spaces inside their brackets.

No upstream issue has a number yet, so the recipe is named after the
behaviour.

## Sources

| Role | Repository | Commit | Followed branch |
| --- | --- | --- | --- |
| baseline | [biomejs/biome](https://github.com/biomejs/biome) | `ef61338b24b7125fbc3cb3d4792ec90fa005a86e` | `main` |
| fix | [JamBalaya56562/biome](https://github.com/JamBalaya56562/biome/tree/fix/migrate-prettier-bracket-spacing) | `c023cb4bde6b7da703ec8f73fea1807501f6bf91` | `fix/migrate-prettier-bracket-spacing` |

`recipe.json` declares both as `guests`. `commit` is what the fixed-guest
builder builds and what `fixed-guest-bump` moves; `accepted` is the build a
maintainer accepted from its Release, and only `accepted` runs on the site.

| Role | Accepted Release | ELF SHA256 |
| --- | --- | --- |
| baseline | `guest-biome-086287f859011917208c205bd00239373027ed52fffdc7d07f9526129268322c` | `97c88a1cb957ecb557ddf9eb9299c8a515d4b7f2c0dd50c60ed91e19ffdeb7a6` |
| fix | `guest-biome-999c685da090c053fe294038463adc16bb99d6f8a62cb61848060d0e8b6d8a36` | `bd96d98fe5b2e24c3bd5610ac4b848f90d54d54cb67dbabe06a8a3c0120a1a4c` |

The baseline reuses the build `biome-migrate-override-bracket-spacing`
accepted: the same commit has this bug too. Both guests are accepted, and
`src/layer1_wasm/formicarium.pin.json` pins the formicarium package, so the
recipe is **active**: it is on the site and in the regression suite.

## The input

Each terminal starts from the recipe's `fixture/` in `/work/app`:

- `.prettierrc`: `{"bracketSpacing":false}`
- `biome.json`: `{}`

Both terminals run the same commands:

```sh
cat .prettierrc
cat biome.json
biome migrate prettier --write
cat biome.json
```

The page reads the top-level `formatter.bracketSpacing` of the migrated
`biome.json`. `false` is corrected; `true` is reproduced. The verdict comes
from the baseline alone; the fix pane reports whether the fix is corrected.
A failed check, command or parse is reported as an error, never as a verdict.

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
`Cross-Origin-Resource-Policy` header therefore fails on this page.

formicarium's `LICENSE` and `THIRD_PARTY_NOTICES.md` are staged with it in
the page's `_formicarium/<version>/` directory; `assets.json` there lists
every staged file and its SHA256. Biome's licence is in its repository at the
commits above.
