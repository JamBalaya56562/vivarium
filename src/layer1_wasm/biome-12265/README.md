# biomejs/biome#12265 — Prettier migration changes omitted defaults

An empty Prettier configuration (`{}`) means `semi: true` and
`singleQuote: false`. Biome's `PrettierConfiguration::default` instead sets
`semi: false` and `single_quote: true`. Migrating it therefore changes the
formatter's behaviour without an explicit user choice.

## Source comparison

- Before: [biomejs/biome at 2405c7620169bd0719166af09a8d89cc76fb37fb](https://github.com/biomejs/biome/commit/2405c7620169bd0719166af09a8d89cc76fb37fb).
- After: the latest published Terrarium build of
  [JamBalaya56562/biome's fix/migrate-prettier-default-semi-quotes branch](https://github.com/JamBalaya56562/biome/tree/fix/migrate-prettier-default-semi-quotes).
  The accepted full commit appears in `recipe.json` and the page.

The baseline is the parent of the original fixing commit
`374751ab0abab3f23ffb3f698392c0847421f0ec`. Later candidate commits are
verified independently against that same baseline.
The baseline stays pinned so upstream main advancing cannot silently change
the bug being reproduced.

The daily `upstream-bump` workflow follows the candidate branch by selecting
its latest **published Terrarium build**, rather than an unbuilt GitHub branch
head. It opens a pin-update PR, whose regression tests verify the actual
migration result before merging. The recipe records the exact accepted commit
in `recipe.json`; the driver checks it before executing either terminal.
Deployment and pin-update merging are separate operations, so the source check
can still fail between them. Following a branch does not guarantee a passing
comparison if that branch stops fixing the bug.

The fix changes the two defaults and adds an empty-configuration regression
test. See the [source diff](https://github.com/JamBalaya56562/biome/compare/2405c7620169bd0719166af09a8d89cc76fb37fb...fix/migrate-prettier-default-semi-quotes).
Upstream issue: [biomejs/biome#12265](https://github.com/biomejs/biome/issues/12265).
The recipe and its Contract v1 envelope use that issue number.

## Run the same input

Terrarium selections `migrate-prettier-before` and `migrate-prettier-after`
use the same `biome-migrate-prettier` fixture. Each terminal owns a separate
disk with `biome.json` and `.prettierrc` initially containing `{}`.

```sh
cat .prettierrc
cat biome.json
biome migrate prettier --write
cat biome.json
```

| Generated `javascript.formatter` field | Before | After |
| --- | --- | --- |
| `semicolons` | `asNeeded` | `always` |
| `quoteStyle` | `single` | `double` |

These are the comparison assertions, not fabricated terminal output. The page
displays actual stdout and records both generated configurations, command
exit codes, source commits and fixture input in `__VIVARIUM_RESULT__`.
It rejects unexpected source commits or fixture input. A failed command or
malformed configuration cannot count as a reproduced bug or a successful fix.

## Runtime and publication checks

Use the native-capable module served by Terrarium Pages; npm `0.1.0` contains
the older Emscripten-only terminal. The module's deployment query separates
caches but is not an immutable source pin. The driver checks the compiled
guest's full source commit before running either session, so a moving branch
cannot silently replace the comparison.

On 2026-10-11, [the public catalogue](https://aletheia-works.github.io/terrarium/web/dist/builds.json)
contained both selections at the commits above and the shared fixture.
The recipe tests check both English and Japanese in Chromium, Firefox and WebKit.
The independent Terrarium acceptance also covers Node execution.

Native execution requires a Worker served from the page's origin. Vivarium
and Terrarium share the production Pages origin; local test and docs servers
proxy the public `/terrarium/web/` assets to preserve that requirement.

Standalone comparison URLs after the catalogue is deployed:

- [Before](https://aletheia-works.github.io/terrarium/?tool=biome&ref=migrate-prettier-before&fixture=biome-migrate-prettier)
- [After](https://aletheia-works.github.io/terrarium/?tool=biome&ref=migrate-prettier-after&fixture=biome-migrate-prettier)

Registration follows the existing recipe-local metadata and bilingual terminal
template. Merge and production publication remain human actions.
