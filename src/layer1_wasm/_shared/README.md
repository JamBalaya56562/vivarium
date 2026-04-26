# `_shared/` — Phase 1 reproduction gallery scaffolding

Shared modules used by every reproduction page in `src/layer1_wasm/`.
The leading underscore is the convention for "this directory is not a
reproduction" — `deploy-docs.yml` recognises it and bundles the contents
under `<pages-base>/poc/_shared/` without requiring an `index.html`.

## Source language

Layer 1 sources are **TypeScript** (`.ts`). The repo-root toolchain
([`src/layer1_wasm/package.json`](../package.json),
[`tsconfig.json`](../tsconfig.json)) transpiles each `.ts` file 1:1 into a
side-by-side `.js` file via `tsc`. HTML pages reference the compiled
`.js` paths so the browser loads plain ES modules — no bundler runtime,
no module loader shim. Generated `.js` and `.js.map` are gitignored;
only the `.ts` source belongs in version control.

Why `tsc` instead of Bun's bundler: 1:1 emission preserving the import
graph is exactly what `tsc` does. Bun's `bun build` is bundler-oriented
and would inline cross-file imports, which is the wrong shape for a
gallery of small per-page modules. Bun is still the package manager
and runner — `bun install`, `bun run build`, `bun run typecheck`.

## Contents

| Source (.ts) | Compiled (.js, gitignored) | Purpose |
| --- | --- | --- |
| `verdict.ts` | `verdict.js` | `setVerdict()` / `setResult()` + `VivariumResultV1` interface. |
| `loader.ts` | `loader.js` | `loadVivariumPyodide()` — Pyodide bootstrap with version pin and package preload. |
| `_test/repro.ts` | `_test/repro.js` | Smoke test validating the contract-v1 surface (no Pyodide). |
| `style.css` | — | Shared CSS for the gallery's visual presentation. |
| `_test/index.html` | — | Smoke test entrypoint. References `./repro.js`. |

## Vivarium contract v1

These helpers publish the **vivarium contract v1** surface. Each page
that uses them must declare:

```html
<meta name="vivarium-contract" content="v1" />
```

The contract surface is canonical here. Reproduction pages should not
hand-roll the verdict logic — import from `_shared/verdict.js` so a
future `v2` migrates in one place. The full surface (DOM, globals,
envelope shape) is documented as TypeScript types in `verdict.ts` and
in the maintainer's private ADR-0008.

## Verdict semantics

- `pass` — the bug **reproduces**. The behaviour the upstream issue
  describes is observable in the runtime this page loaded.
- `fail` — the bug does **not** reproduce. Either the runtime ships a
  fixed version, or it errored before producing a result.
- `pending` — the run has not yet produced a verdict.

`pass` meaning "the bug is still there" is counterintuitive in
isolation but matches the project's domain noun: a *reproduction*
succeeds when it reproduces.

## Local development

```bash
# 1. From the layer1 sources directory:
cd src/layer1_wasm

# 2. Install TypeScript (one-time per machine / lockfile change).
bun install

# 3. Build (.ts → .js, side-by-side). Use `--watch` during active edits.
bun run build
# or:  bun run watch

# 4. Type-check without emitting — useful for CI / fast feedback.
bun run typecheck

# 5. Serve the smoke test.
python -m http.server -d _shared 8766
# then open http://localhost:8766/_test/
```

## Smoke test expectations

Open `<pages-base>/poc/_shared/_test/` in a browser. Expected:

- The verdict band shows `reproduction succeeded — _shared helpers
  wired up.` and `data-verdict="pass"`.
- `globalThis.__VIVARIUM_VERDICT__ === "pass"`.
- `globalThis.__VIVARIUM_RESULT__.contract === "v1"`.
- Network: only the smoke-test page itself plus `verdict.js` and
  `repro.js`. No CDN traffic.

The smoke test does **not** load Pyodide — it only validates the
helper plumbing. Reproduction-level smoke tests live in each per-bug
page.

## Deployment path

`deploy-docs.yml` runs `bun install --frozen-lockfile` and `bun run
build` in this directory before bundling, so the `.js` outputs exist
when the deploy step copies the tree. It then iterates immediate
subdirectories of `src/layer1_wasm/`; the default rule (must contain
`index.html`) is relaxed for underscore-prefixed directories so that
shared scaffolding ships without pretending to be a reproduction. The
modules end up at `<pages-base>/poc/_shared/`, reachable from each
reproduction at the relative path `../_shared/…`.
