#!/usr/bin/env node
//
// Vivarium MCP server — stdio entrypoint.
//
// Spawned by an MCP client (Claude Code, Cline, Cursor, Continue, …)
// via `npx -y @aletheia-works/vivarium-mcp` or the equivalent JSR
// invocation. Speaks the MCP protocol over stdin / stdout.
//
// See packages/mcp-server/README.md for client configuration snippets
// and ADR-0019 (private memo) for the design rationale.

import { runServer } from './server.js';

runServer().catch((err: unknown) => {
  // The MCP transport itself uses stdout, so all human-visible
  // diagnostics go to stderr.
  console.error('vivarium-mcp: fatal:', err);
  process.exit(1);
});
