# Reproduction — aubepkg/aube#1645

> The aube CLI itself, compiled to WebAssembly by
> [terrarium](https://github.com/aletheia-works/terrarium), runs a
> terminal session in the browser — one terminal per build.
> Conforms to `vivarium-contract: v1`.

## The bug

[aubepkg/aube#1645](https://github.com/aubepkg/aube/pull/1645) —
pnpm-format lockfiles (`aube-lock.yaml`, `pnpm-lock.yaml`) record where
a `file:` directory or `link:` dependency lives, but no version. aube's
reader fills in a `0.0.0` placeholder, so everything that reads the
lockfile instead of resolving reports those packages as `0.0.0`:

```text
$ aube install                      # fresh resolve
+ filedep@1.0.0
+ linked@2.0.0
$ rm -rf node_modules
$ aube install --frozen-lockfile
+ filedep@0.0.0
+ linked@0.0.0
$ aube list
├── filedep 0.0.0
└── linked 0.0.0
```

The upstream reference is a pull request rather than an issue: the bug
was reported together with its fix, so `1645` in the slug is the PR
number.

## Why this bug

- A CLI bug reads best as a terminal session. terrarium runs the real
  `aube` binary, unpatched, on top of only the system calls it needs,
  so the page shows exactly what a user would see in their terminal.
- The verdict is a comparison of two strings per package — the version
  `aube list` prints and the one in the package's own `package.json` —
  so the page emits a mechanically distinguishable `reproduced` /
  `unreproduced`.
- The fix is an open pull request. terrarium publishes a build of it as
  `pr-1645`, so the page runs the same session against the latest
  release and against the fix, side by side. When the fix ships in a
  release, moving the baseline to that release flips the page to
  `unreproduced`.

## Files

| File | Role |
| ---- | ---- |
| `index.html` | Generated from `page.en.html` by `mise run repro:pages`; gitignored. |
| `repro.ts` | TypeScript — loads `@aletheia-works/terrarium` through `_shared/terrarium_loader.ts`, mounts one `<terrarium-terminal>` per build, types the session into both, and derives the verdict and envelope from what each command printed. |
| `coi-serviceworker.js` | [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) v0.1.7 (MIT). GitHub Pages cannot send COOP/COEP headers, and terrarium's threads need a cross-origin isolated page, so this service worker adds them. It has to sit next to the page it controls. |

The project the session runs in is terrarium's `aube-local-deps`
fixture: `/work/app` depends on `filedep` (`file:./filedep`, version
1.0.0) and `linked` (`link:../outside/linked`, version 2.0.0).

## Builds

| Pane | terrarium `ref` | Pinned where |
| ---- | --------------- | ------------ |
| Baseline | `v2.6.1` | `repro.ts` and `recipe.json` `upstream`, moved by the daily `upstream-bump` workflow |
| Fix candidate | `pr-1645` | terrarium, which rebuilds the pull request's head when its Pages workflow runs for `pr-1645` |

terrarium has to have published a build for the ref before the page can
load it; the published builds are listed in its
[`builds.json`](https://aletheia-works.github.io/terrarium/web/dist/builds.json).
Each envelope records the commit terrarium reports for each build.

## Verdict contract — `vivarium-contract: v1`

The page conforms to the contract canonicalised in
[`../_shared/verdict.ts`](../_shared/verdict.ts). The `result` field
of the envelope reports `packages` (name, version printed by
`aube list`, version from `package.json`) and `reproduced`, plus
`baseline` and `fix_candidate` objects with each build's `ref`,
`commit`, `packages`, `reproduced`, and the first command that exited
non-zero, if any.

A `reproduced` verdict means **the bug reproduced** — every command in
the baseline session exited 0, and at least one local package's version
in `aube list` differs from its `package.json`. An `unreproduced`
verdict means `aube list` carries the real versions, a command failed,
or terrarium could not load.

## Native verification

Install aube v2.6.1 and run the same session in a copy of the fixture:

```bash
mkdir -p app/filedep outside/linked
echo '{"name":"filedep","version":"1.0.0"}' > app/filedep/package.json
echo '{"name":"linked","version":"2.0.0"}' > outside/linked/package.json
echo '{"name":"app","version":"1.0.0","dependencies":{"filedep":"file:./filedep","linked":"link:../outside/linked"}}' > app/package.json
cd app
aube install
rm -rf node_modules
aube install --frozen-lockfile
aube list
# filedep 0.0.0 and linked 0.0.0 — the bug
```

## Deployment

Published to GitHub Pages at
`https://aletheia-works.github.io/vivarium/repro/aube/1645/` by the
`deploy-docs` workflow.
