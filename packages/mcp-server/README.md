# `@aletheia-works/vivarium-mcp`

[Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the [Vivarium](https://github.com/aletheia-works/vivarium)
reproduction catalogue to AI agent clients (Claude Code, Cline, Cursor,
Continue, etc.).

Vivarium is the universal bug-reproduction platform of the
[`aletheia-works`](https://github.com/aletheia-works) organisation —
"reproduce any bug, in any language, any environment, at any scale."
This package is the agent-callable surface that lets AI tools
*discover* what reproductions exist, look up their metadata, and read
deployed verdict snapshots, without scraping the docs site.

## Tools

| Tool | Returns | Layer coverage |
|---|---|---|
| `list_recipes(layer?, project?, q?)` | Filtered list of catalogue entries. | All layers (1, 2, 3). |
| `get_recipe(slug)` | Full metadata for one recipe (title, project, issue, page URL, verdict snapshot URL, GitHub source URL). | All layers. |
| `lookup_verdict(slug)` | Layer 1 → `kind: "live"` + page URL (verdicts run in the browser). Layer 2/3 → `kind: "snapshot"` with the deployed `verdict.json` contents (verdict, exit code, image digest, stdout, stderr tail). | All layers (Layer 1 returns a stub). |
| `match_error(text, limit?)` | Mechanical token-overlap ranking of recipes against a pasted error message or stack trace. Synonym table + bounded fuzzy match + multi-language stopwords. | All layers. |
| `verify_branch_fix(slug, fix_url? \| fix_source?)` | Scaffolding helper for the AI-slop verification loop. Layer 1 → Path A: a recipe-page `compare_url` with the fix pre-loaded. Layer 2/3 → Path B: a `/repro/compare` deep-link plus the `gh workflow run branch-fix-verdict.yml` command. NOT an execution engine — actual reproduction runs in the visitor's browser (Path A) or in GitHub Actions (Path B). | All layers. |
| `prepare_new_recipe(project, issue, title, base_image?, repo_owner?, layer?)` | Scaffolding helper that bundles every artefact an agent needs to author a new recipe: validated slug, the exact `mise run recipes:new` and `mise run recipes:verify` commands, a placeholder `recipe.json` to drop into the recipe directory (validates against `docs/site/public/spec/recipe.schema.json`), an optional `projects.json` row (only when the recipe debuts a new upstream project), a commit-subject template, and a sequenced next-steps checklist. NOT an execution engine — the agent's shell tool runs the returned commands. | Layer 2 has the canonical scaffolder; Layer 1/3 fall back to copying from an existing recipe. |
| `prepare_fix_candidate(slug, fork_url, branch, upstream_pr?, package?, purpose?)` | Scaffolding helper that registers a fix-candidate spec on an existing Layer 1 recipe so the page runs the fork branch's wheel side-by-side with the released build (per ADR-0040). Returns the `fix-candidate.json` content, the recommended commit subject + PR title, a ready-to-paste PR body (with AI-authorship disclosure tucked inside a `<details>` block), and the exact `gh` / `git` commands to fork-and-clone aletheia-works/vivarium, branch off main, drop the spec in, commit, push, and open the cross-repo PR. NOT an execution engine — the agent's shell tool runs the returned commands. | Layer 1 only (Layers 2/3 use `verify_branch_fix`). |

## Install

The exact MCP-config file location varies by client (Claude Code:
`~/.claude/mcp.json`; Cline: its VS Code settings; Cursor:
`~/.cursor/mcp.json`).

### npm (default for `npx`-based MCP launchers)

```json
{
  "mcpServers": {
    "vivarium": {
      "command": "npx",
      "args": ["-y", "@aletheia-works/vivarium-mcp@latest"]
    }
  }
}
```

### JSR (Bun / Deno native install)

```bash
bunx jsr:@aletheia-works/vivarium-mcp
# or
deno run --allow-net --allow-read jsr:@aletheia-works/vivarium-mcp
```

## Configuration

The server reads no environment variables and accepts no command-line
flags in v1. It fetches the catalogue index from
<https://aletheia-works.github.io/vivarium/api/recipes.json> with a
5-minute in-process TTL, falling back to a build-time bundled snapshot
when the network is unavailable.

## Versioning

The MCP server's tool surface (the tools listed above and their input
schemas) is locked at v1. Optional additive changes ship as minor
revisions; breaking changes require a v2 release.

The recipes index format consumed by this server is locked separately
at `index = "v1"` — see
<https://aletheia-works.github.io/vivarium/spec/recipes-index-v1>.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
