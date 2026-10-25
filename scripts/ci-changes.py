#!/usr/bin/env python3
"""Which CI test groups a pull request's changed files need; unknown paths need every group."""

import argparse
import os
import sys

GROUPS = ("docs", "repro", "mcp", "builder")
ALL = frozenset(GROUPS)
NONE = frozenset()
# The pull-request files API lists at most 3000 files; a longer list may be cut.
API_LIMIT = 3000

# First match wins: "dir/" matches everything below dir, "*.ext" any file
# with that extension, anything else the exact path.
RULES = (
    (
        ALL,
        (
            ".github/workflows/ci.yml",
            "scripts/ci-changes.py",
            "package.json",
            "mise.toml",
            "mise-tasks/",
            ".python-version",
            ".github/actions/",
        ),
    ),
    (
        {"builder"},
        (
            "tools/fixed-guest-builder/tests/",
            "tools/fixed-guest-builder/bunfig.toml",
            "tools/fixed-guest-builder/README.md",
            ".github/workflows/test-fixed-guest-builder.yml",
            ".github/workflows/fixed-guest-build.yml",
            ".github/workflows/fixed-guest-bump.yml",
            ".github/workflows/fixed-guest-release.yml",
            ".github/workflows/fixed-guest-prune.yml",
        ),
    ),
    # docs/scripts imports the builder's sources and reads its tools.json.
    ({"builder", "docs", "repro"}, ("tools/fixed-guest-builder/",)),
    # The docs build counts the MCP tools; the release tests read the manifests.
    (
        {"mcp", "docs"},
        (
            "packages/mcp-server/src/tools/",
            "packages/mcp-server/package.json",
            "packages/mcp-server/jsr.json",
        ),
    ),
    ({"mcp"}, ("packages/mcp-server/", ".github/workflows/test-mcp.yml")),
    (
        {"docs"},
        (
            ".github/workflows/test-docs.yml",
            ".github/workflows/deploy-docs.yml",
            ".github/release-please-config.json",
            ".github/release-please-manifest.json",
            ".gitignore",
            "docs/site/en/",
            "docs/site/ja/",
            "docs/site/_components/",
            "docs/site/_styles/",
            "docs/tests/",
            "docs/playwright.config.ts",
            "docs/rspress.config.ts",
        ),
    ),
    # The MCP package bundles the recipes index and its tests read it.
    ({"docs", "repro", "mcp"}, ("docs/site/public/api/recipes.json",)),
    (NONE, ("scripts/schedule-watch.py", ".github/workflows/schedule-watch.yml")),
    (
        {"docs", "repro"},
        (
            ".github/workflows/repro-regression.yml",
            "src/",
            "docs/",
            "scripts/",
        ),
    ),
    # Polyglot lint checks these on every pull request.
    (
        NONE,
        (
            "infra/",
            ".claude/",
            ".github/",
            "*.md",
            "LICENSE",
            ".rumdl.toml",
            "mago.toml",
            "ruff.toml",
            "tombi.toml",
        ),
    ),
)


def matches(path, pattern):
    if pattern.endswith("/"):
        return path.startswith(pattern)
    if pattern.startswith("*."):
        return path.endswith(pattern[1:])
    return path == pattern


def groups_for(path):
    for groups, patterns in RULES:
        if any(matches(path, p) for p in patterns):
            return frozenset(groups)
    return ALL


def needed(paths):
    paths = [p for p in paths if p]
    if not paths or len(paths) >= API_LIMIT:
        return ALL
    return frozenset().union(*(groups_for(p) for p in paths))


def self_test():
    cases = {
        "AGENTS.md": NONE,
        "README.md": NONE,
        "SECURITY.md": NONE,
        ".claude/rules/recipe-authoring.md": NONE,
        "infra/github/main.tf": NONE,
        ".github/labeler.yml": NONE,
        ".github/workflows/claude-review.yml": NONE,
        ".github/workflows/terraform-plan.yml": NONE,
        ".github/workflows/schedule-watch.yml": NONE,
        "scripts/schedule-watch.py": NONE,
        "ruff.toml": NONE,
        ".github/workflows/ci.yml": ALL,
        "scripts/ci-changes.py": ALL,
        "package.json": ALL,
        "mise.toml": ALL,
        "mise-tasks/repro/build/rust.sh": ALL,
        ".github/actions/bot-pull-request/action.yml": ALL,
        "unknown-top-level-file": ALL,
        "tools/fixed-guest-builder/tests/key.test.ts": {"builder"},
        "tools/fixed-guest-builder/bunfig.toml": {"builder"},
        ".github/workflows/fixed-guest-release.yml": {"builder"},
        ".github/workflows/fixed-guest-prune.yml": {"builder"},
        ".github/workflows/test-fixed-guest-builder.yml": {"builder"},
        "tools/fixed-guest-builder/src/artifact.ts": {"builder", "docs", "repro"},
        "tools/fixed-guest-builder/tools.json": {"builder", "docs", "repro"},
        "packages/mcp-server/src/tools/search.ts": {"mcp", "docs"},
        "packages/mcp-server/package.json": {"mcp", "docs"},
        "packages/mcp-server/src/server.ts": {"mcp"},
        "packages/mcp-server/README.md": {"mcp"},
        ".github/workflows/test-mcp.yml": {"mcp"},
        "docs/site/en/roadmap.mdx": {"docs"},
        "docs/site/_components/LiveExamples.tsx": {"docs"},
        ".github/workflows/deploy-docs.yml": {"docs"},
        ".github/release-please-manifest.json": {"docs"},
        ".gitignore": {"docs"},
        ".github/workflows/repro-regression.yml": {"docs", "repro"},
        "docs/scripts/stage-formicarium-assets.ts": {"docs", "repro"},
        "docs/site/public/api/recipes.json": {"docs", "repro", "mcp"},
        "docs/site/public/api/projects.json": {"docs", "repro"},
        "src/layer1_wasm/_shared/style.css": {"docs", "repro"},
        "src/layer1_wasm/dateutil-1478/README.md": {"docs", "repro"},
        "src/layer2_docker/bash-local-shadows-exit/Dockerfile": {"docs", "repro"},
        "scripts/bundle-layer1-pages.sh": {"docs", "repro"},
    }
    for path, expected in cases.items():
        got = groups_for(path)
        if got != frozenset(expected):
            raise AssertionError(f"{path}: {sorted(got)} != {sorted(expected)}")
    if needed([]) != ALL or needed(["AGENTS.md"] * API_LIMIT) != ALL:
        raise AssertionError("an empty or possibly cut file list must need every group")
    if needed(["AGENTS.md", "infra/github/main.tf"]) != NONE:
        raise AssertionError("prose and infrastructure need no group")
    if needed(["packages/mcp-server/src/server.ts", "docs/site/en/a.mdx"]) != {"mcp", "docs"}:
        raise AssertionError("groups of several files must be joined")
    print(f"ci-changes ready: {len(cases)} paths checked")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--all", action="store_true", help="need every group")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    groups = ALL if args.all else needed(sys.stdin.read().splitlines())
    lines = [f"{g}={'true' if g in groups else 'false'}" for g in GROUPS]
    print("\n".join(lines))
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
