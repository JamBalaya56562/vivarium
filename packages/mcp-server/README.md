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

## Install

### npm (default for `npx`-based MCP launchers)

Add the server to your client's MCP configuration. The exact file
location varies by client (Claude Code: `~/.claude/mcp.json`; Cline:
its VS Code settings; Cursor: `~/.cursor/mcp.json`). Snippet:

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

### JSR (Deno / Bun-native install)

For clients with native JSR support (Bun ≥ 1.1, Deno):

```bash
bunx jsr:@aletheia-works/vivarium-mcp
# or
deno run --allow-net --allow-read jsr:@aletheia-works/vivarium-mcp
```

## Why dual-channel distribution

Per [ADR-0019](https://github.com/aletheia-works/vivarium) (private
memo), this package publishes to both registries with **JSR canonical
and npm fallback**. JSR contributes structural supply-chain defences
(no postinstall scripts, OIDC-only publish via Sigstore provenance,
GitHub-org-bound scope ownership, source-only publish); npm carries
the `npx` ergonomics most MCP launchers expect today. Both registries
ship with build provenance — verifiable via the public Sigstore Rekor
transparency log.

## Configuration

The server reads no environment variables and accepts no command-line
flags in v1. It fetches the catalogue index from
<https://aletheia-works.github.io/vivarium/api/recipes.json> with a
5-minute in-process TTL, falling back to a build-time bundled snapshot
when the network is unavailable.

## Versioning

The MCP server's surface (the three tools above and their input
schemas) is locked at v1 by ADR-0019. Optional additive changes ship
as minor revisions; breaking changes require a v2 design ADR.

The recipes index format consumed by this server is locked separately
at `index = "v1"` — see
<https://aletheia-works.github.io/vivarium/spec/recipes-index-v1>.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
