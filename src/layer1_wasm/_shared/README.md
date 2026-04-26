# `_shared/` — Phase 1 reproduction gallery scaffolding

Shared modules used by every reproduction page in `src/layer1_wasm/`.
The leading underscore is the convention for "this directory is not a
reproduction" — `deploy-docs.yml` recognises it and bundles the contents
under `<pages-base>/poc/_shared/` without requiring an `index.html`.

## Contents

| File | Purpose |
| --- | --- |
| `verdict.mjs` | `setVerdict()` / `setResult()` helpers + the `VivariumResultV1` JSDoc typedef. |
| `loader.mjs` | `loadVivariumPyodide()` — Pyodide bootstrap with version pin and package preload. |
| `style.css` | Shared CSS for the gallery's visual presentation. |
| `_test/` | Smoke test that validates the contract-v1 surface without loading Pyodide. |

## Vivarium contract v1

These helpers publish the **vivarium contract v1** surface. Each page
that uses them must declare:

```html
<meta name="vivarium-contract" content="v1" />
```

The contract surface is canonical here. Reproduction pages should not
hand-roll the verdict logic — import from `_shared/verdict.mjs` so a
future `v2` migrates in one place.

The full surface (DOM, globals, envelope shape) is documented in the
`verdict.mjs` JSDoc and in the maintainer's private ADR-0008.

## Verdict semantics

- `pass` — the bug **reproduces**. The behaviour the upstream issue
  describes is observable in the runtime this page loaded.
- `fail` — the bug does **not** reproduce. Either the runtime ships a
  fixed version, or it errored before producing a result.
- `pending` — the run has not yet produced a verdict.

`pass` meaning "the bug is still there" is counterintuitive in
isolation but matches the project's domain noun: a *reproduction*
succeeds when it reproduces.

## Smoke test

Open `<pages-base>/poc/_shared/_test/` in a browser. Expected:

- The verdict band shows `reproduction succeeded — _shared helpers
  wired up.` and `data-verdict="pass"`.
- `globalThis.__VIVARIUM_VERDICT__ === "pass"`.
- `globalThis.__VIVARIUM_RESULT__.contract === "v1"`.

The smoke test does **not** load Pyodide — it only validates the
helper plumbing. Reproduction-level smoke tests live in each per-bug
page.

## Local serving

Any static HTTP server works — there are no build steps, no bundlers,
no cookies, no COOP/COEP requirements:

```bash
python -m http.server -d src/layer1_wasm/_shared 8000
# then open http://localhost:8000/_test/
```

## Deployment path

`deploy-docs.yml` iterates immediate subdirectories of
`src/layer1_wasm/`. The default rule (must contain `index.html`) is
relaxed for underscore-prefixed directories so that shared scaffolding
ships without pretending to be a reproduction. The shared modules end
up at `<pages-base>/poc/_shared/`, reachable from each reproduction at
the relative path `../_shared/…`.
