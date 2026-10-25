# Fixed guest builder

Builds the Linux musl ELF a recipe guest runs in
[formicarium](https://github.com/aletheia-works/formicarium), from a
declared repository and full commit, and keeps one verified set per build
key in this repository's GitHub Releases. A set is the ELF, its
`build-info.json`, a one-entry `catalog.json`, and the two license files the
ELF is redistributed with: `LICENSE` and `THIRD_PARTY_NOTICES.md`.

The same key is never compiled twice: a later build of an unchanged key
downloads the published set, verifies it, and records `compiled: false`.

## Running a build

Start **fixed-guest-build** from `main` (Actions → Run workflow) with the
guest's `tool`, `repository`, 40-character `commit` and `fixture`. The run
refuses to start while another run's build job is in progress (exit code 2,
`BUSY`); start it again once that build ends. A run that has finished its
build and is only releasing does not count. Builds are not queued in a
concurrency group, because GitHub keeps only one pending run in a group and
cancels the one before it.

The run checks, in order:

1. The repository is in `allowlist.json` and the commit is 40 hex.
2. The commit is reachable from the repository's own branches or tags.
   A commit that exists only in another fork of the network is refused.
3. The source pins its Rust toolchain, or, when it pins none, the tool's
   `rustToolchain` in `tools.json` names one; the pinned image in
   `tools.json` has exactly that Rust.
4. `Cargo.lock` exists, and every source in it is crates.io or an
   allowlisted git repository pinned to a commit. Source replacement and
   other registries are refused.
5. If a Release for the key is already published, it is verified and
   reused. Otherwise dependencies are fetched (watched against a 4 GiB
   limit) and the ELF is built offline in the container.
6. The license files are made offline in the same image. The pinned
   cargo-about lists every crate the tool's package uses on its target,
   with the license text each crate ships; any license not accepted in
   `container/about.toml` stops the build. `THIRD_PARTY_NOTICES.md` holds
   that listing. `LICENSE` holds the license files at the source's root and
   in each of its own crates in the build, such as notices for code taken
   from other projects. `build-info.json` records both files' SHA256 and
   size in `licenseFiles`.

The whole run has a 4-hour deadline. Source and dependency sizes, timings
and free disk are in the run's receipt.

## Publishing a set

Publishing needs no approval. A person only starts the build; the release
and the acceptance follow from it.

1. When the build job succeeds, the same run calls **fixed-guest-release**
   with its own run ID.
2. The `prepare` job (read-only token) checks through the
   GitHub API that the run is a `workflow_dispatch` of
   `fixed-guest-build.yml` on `main` in this repository, that its build job
   succeeded, and that it holds the artifact `fixed-guest-<run id>`. It then
   takes the tool, key, repository and commit from the receipt and checks
   them against `build-info.json`, the catalog, the files' digests and
   `tools.json`, which gives the binary. Any disagreement stops the run. It
   writes the plan and shows the plan JSON, its SHA256, the tag and every
   digest in the job summary.
3. The `publish <plan SHA256>` job waits for its turn (below), takes the
   plan file, checks that its SHA256 equals the one `prepare` reported and
   that it still matches the set, checks that the repository is still in
   `allowlist.json`, and publishes.
4. The `accept` job writes the published build as `accepted` into every
   guest under `src/layer1_wasm/*/recipe.json` whose `tool`, `repository`
   and `commit` are the build's. When that changes a recipe, it opens a pull
   request as `aletheia-works-bot` on `fixed-guest-accept/<tool>-<key>` that
   merges itself once the required checks pass; that pull request's CI
   stages the accepted builds and re-runs the recipes. A guest whose commit
   is not on `main` yet, such as one in an open recipe pull request, is not
   touched; give it its `accepted` block in that pull request.

To release a build later, or to try again, start **fixed-guest-release**
with only the build run ID.

Release runs are not queued in a concurrency group, so a release is never
cancelled by a later one. A publish job waits while another run's
publish job is writing, whether that run is a release run or a build run
that called the release. When two wait at once, the smaller run ID goes
first. A job checks again with a growing delay (5 s up to 60 s) and, if it
is still not its turn after 20 minutes, fails as `BUSY` without writing;
start the release again with the build run ID.

When the build reused a published Release (`compiled: false`), the release
run checks that Release and writes nothing.

The release run uploads to a draft, downloads the files again and checks
every digest, and only then publishes. A published Release is never
replaced. If one already exists for the key, the run only verifies it; a
different ELF for the same key is reported as `NOT_REPRODUCIBLE` and
nothing is written.

## Deleting unreferenced sets

The daily **fixed-guest-prune** run deletes a published
`guest-<tool>-<buildKey>` Release, and its tag, 30 days after nothing
accepts its key any more. A key is accepted while a
`guests[].accepted.buildKey` names it in a `src/layer1_wasm/*/recipe.json`
on `main`, or in one an open pull request carries at its head. Whether a
recipe was retired or a guest moved to a newer build does not matter; only
the reference does.

The 30 days start at the `main` commit that last changed the key's
references (the run reads the full history), or at the Release's
publication when `main` never named the key. Drafts are left to their
release run. A `guest-*` tag with no Release, such as one left by a run that
deleted the Release but failed on the tag, is deleted on the next run unless
its key is referenced. The job summary lists every guest Release as referenced (and
by what), waiting (with the date it goes) or deleted.

Start **fixed-guest-prune** by hand to see the list: `dry_run` is on by
default and deletes nothing. The scheduled run deletes.

## Moving a guest to a newer commit

Start **fixed-guest-bump** with the recipe path and the guest's role
(`baseline` or `fix`). The guest must name a branch in `reference.branch`:
`main` of the upstream for the baseline, the fix branch of the fork for the
fix. The branch tip is read with `git ls-remote`; PR pages are never used.
Only the guest's `commit` moves; its `accepted` build stays, so the site keeps
running it until the build of the new commit is published and accepted. The
run opens a pull request on `fixed-guest-bump/<recipe>-<role>` that merges
itself once the required checks pass; start the fixed build of the new
commit after it merges, so the acceptance finds the commit on `main`.

## Changing what may be built

- `allowlist.json`: `repositories` lists where a guest may be built from;
  `dependencyRepositories` lists git sources Cargo may fetch from. Entries
  must already be in `https://github.com/<owner>/<repo>` form, lowercase.
- `tools.json`: the pinned image for each Rust version, the mbx and
  cargo-about archives, and each tool's package, binary, target,
  environment, extra packages, and the Rust to use when its source pins
  none (`rustToolchain`). Extra packages are installed in one `apk` call,
  so a package's dependencies that the image lacks are listed beside it.
  Changing anything here changes the build keys it affects.
- `container/about.toml`: the licenses cargo-about accepts. Changing it,
  `container/notices.sh` or the cargo-about archive changes every key.

## Limits

| Item | Limit |
|---|---|
| Whole build | 4 hours |
| Source checkout | 2 GiB (provisional) |
| Cargo dependencies | 4 GiB (provisional) |
| Free disk before building | 20 GiB (provisional) |
| ELF | 128 MiB |
| `build-info.json` | 1 MiB |
| `catalog.json` | 4 MiB |
| cargo-about listing | 64 MiB |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | 4 MiB each |

A limit value itself is accepted; one byte more is refused.

## Rolling back

Revert the pull request that changed the builder. For a bad published set,
point the recipe back to the previous key. Its Release is kept for 30 days
after the key stopped being referenced, and pointing back at it within that
time keeps it. After that it is gone: build the previous commit again with
**fixed-guest-build**, which publishes it under the current builder's key,
and accept that build.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

`bun run test` fails below 80% line coverage.
