# Fixed guest builder

Builds the Linux musl ELF a recipe guest runs in
[formicarium](https://github.com/aletheia-works/formicarium), from a
declared repository and full commit, and keeps one verified set per build
key in this repository's GitHub Releases. A set is the ELF, its
`build-info.json` and a one-entry `catalog.json`.

The same key is never compiled twice: a later build of an unchanged key
downloads the published set, verifies it, and records `compiled: false`.

## Running a build

Start **fixed-guest-build** from `main` (Actions → Run workflow) with the
guest's `tool`, `repository`, 40-character `commit` and `fixture`. The run
refuses to start while another build is active (exit code 2, `BUSY`); start
it again once that run ends.

The run checks, in order:

1. The repository is in `allowlist.json` and the commit is 40 hex.
2. The commit is reachable from the repository's own branches or tags.
   A commit that exists only in another fork of the network is refused.
3. The source pins its Rust toolchain, and the pinned image in
   `tools.json` has exactly that Rust.
4. `Cargo.lock` exists, and every source in it is crates.io or an
   allowlisted git repository pinned to a commit. Source replacement and
   other registries are refused.
5. If a Release for the key is already published, it is verified and
   reused. Otherwise dependencies are fetched (watched against a 4 GiB
   limit) and the ELF is built offline in the container.

The whole run has a 4-hour deadline. Source and dependency sizes, timings
and free disk are in the run's receipt.

## Publishing a set

Publishing needs a person's approval of one operation plan.

1. Download the build run's artifact and create the plan:

   ```sh
   bun run src/cli.ts plan --tool <tool> --binary <binary> --key <key> \
     --repository <repository> --commit <commit> --artifacts <dir>/<key> \
     --build-run-id <run id> --rollback "<rollback text>" \
     --approval-reference "<where it was approved>" --plan-out plan.json
   ```

2. The approver checks the printed `planSha256` and the plan's targets and
   digests, and approves that SHA256.
3. Start **fixed-guest-release** with the build run ID, the identity, the
   plan JSON and its SHA256. The run name shows the SHA256; approve the
   `fixed-guest-release` environment only if it matches. The run refuses
   to write anything while that environment has no required reviewers.

The release run uploads to a draft, downloads the files again and checks
every digest, and only then publishes. A published Release is never
replaced or deleted. If one already exists for the key, the run only
verifies it; a different ELF for the same key is reported as
`NOT_REPRODUCIBLE` and nothing is written.

## Moving a guest to a newer commit

Start **fixed-guest-bump** with the recipe path and the guest's role
(`baseline` or `fix`). The guest must name a branch in `reference.branch`:
`main` of the upstream for the baseline, the fix branch of the fork for the
fix. The branch tip is read with `git ls-remote`; PR pages are never used.
Only the guest's `commit` moves; its `accepted` build stays, so the site keeps
running it until a person accepts the build of the new commit. The run opens
a pull request on `fixed-guest-bump/<recipe>-<role>` with auto-merge turned
off, so a person merges it, and the fixed build of the new key runs
separately.

## Changing what may be built

- `allowlist.json`: `repositories` lists where a guest may be built from;
  `dependencyRepositories` lists git sources Cargo may fetch from. Entries
  must already be in `https://github.com/<owner>/<repo>` form, lowercase.
- `tools.json`: the pinned image for each Rust version, the mbx archive,
  and each tool's package, binary, target, environment and extra packages.
  Changing anything here changes the build keys it affects.

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

A limit value itself is accepted; one byte more is refused.

## Rolling back

Revert the pull request that changed the builder. For a bad published set,
point the recipe back to the previous key; published Releases stay.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

`bun run test` fails below 80% line coverage.
