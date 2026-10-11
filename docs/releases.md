# Release automation

Vivarium and all first-party packages use one version, stored in the root
`package.json`. The migration baseline is **0.2.2**, matching the current
MCP metadata. The docs and Layer 1 private packages use that version too.

## Release flow

Every push to upstream `main` runs Release Please. Conventional Commits
across the repository determine the next shared version. Release Please
updates the root `CHANGELOG.md`, root `package.json`, every other package's
`package.json`, and the MCP `jsr.json` in one release PR.

Merge the release PR after reviewing its changelog and required checks.
Release Please creates one `v<version>` tag on the merge commit and one
GitHub release. That same tag triggers `publish-mcp.yml`, which publishes
MCP with the shared version to npm and JSR. A recipe or docs change can
contribute to the shared release just as a package change can.

`fix` produces a patch, `feat` produces a minor, and breaking changes
produce a major after 1.0. Before 1.0, breaking changes produce a minor;
features still produce a minor. Commits such as `docs`, `chore`, and `ci`
do not trigger a release alone. There is no scheduled merge in this stage.

`.github/release-please-manifest.json` contains one root entry, initialized
at the shared 0.2.2 baseline. The bootstrap SHA is the `main` commit before
this migration; initial release notes start with changes after that commit.
After the first unified release, Release Please uses its tag as the next
release boundary and updates the manifest automatically. Existing historical
tags and registry versions retain their original contents.

The docs unit suite tests the release configuration with Release Please
`17.6.0`, matching the engine bundled in `release-please-action` v5.0.0.
When upgrading that action, update the test dependency to its bundled engine
version as well. When adding a package, register its manifest in the root
release configuration's `extra-files` list so its version is updated too.

## Credentials and rollout

Release Please uses the existing `aletheia-works-bot` installation
(`BOT_CLIENT_ID` and `BOT_PRIVATE_KEY`) with Contents, Issues, and Pull
requests write permissions. Its installation token lets release PRs run CI
and tags trigger publishing. npm and JSR publishing use OIDC.

The pending and tagged labels are managed in `infra/github/main.tf`.
The release workflow requires them to exist. A successful Terraform Apply
run triggers reconciliation again, allowing initial rollout to proceed
once the labels exist. Release automation runs only in
`aletheia-works/vivarium` on `main`.

## Recovery

If Release Please fails, fix the reported App permissions or configuration
error, then run **Release** from Actions on `main` to resume reconciliation.

If npm or JSR publication fails, run **publish-mcp** manually with the
existing `v<version>` tag. It checks out that tag, validates both MCP
manifests, and skips versions already published. Only registry HTTP 404
means unpublished; other HTTP and network errors stop the run. GitHub
release creation and registry publishing are separate operations, so a
GitHub release can exist while a registry publication has failed.

For package content fixes, merge a Conventional Commit fix and release the
next shared version. The `publish-mcp.yml` filename remains the npm trusted
publisher entry point.
